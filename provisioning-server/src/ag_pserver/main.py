from twisted.internet.task import react
from twisted.web import static, resource, server
from twisted.web.template import Element, XMLFile, renderer, flattenString
from twisted.internet import endpoints, defer
from twisted.python import usage
import wormhole
import treq
import os.path
import os
import json

from twisted.python import log
import sys
log.startLogging(sys.stdout)

MAILBOX_URL = u"ws://relay.magic-wormhole.io:4000/v1"
#MAILBOX_URL = u"ws://10.0.2.24:4000/v1"
APPID = u"agoric.com/ag-testnet1/provisioning-tool"

htmldir = os.path.join(os.path.dirname(__file__), "html")


class SetConfigOptions(usage.Options):
    pass

class StartOptions(usage.Options):
    optParameters = [
        ["listen", "l", "tcp:8001", "client-visible HTTP listening port"],
        ["controller", "c", "http://localhost:8002/vat", "controller's listening port for us to send control messages"],
    ]

class Options(usage.Options):
    subCommands = [
        ['set-cosmos-config', None, SetConfigOptions, "Pipe output of 'ag-setup-cosmos show-config' to this command"],
        ['start', None, StartOptions, 'Start the HTTP server'],
        ]
    optParameters = [
        ["home", None, os.environ["HOME"] + '/.ag-pserver', "provisioning-server's state directory"],
        ]

def cosmosConfigFile(home):
    return home + '/cosmos-chain.json';

class ConfigElement(Element):
    loader = XMLFile(os.path.join(htmldir, "index.html"))

    def __init__(self, config):
        self._config = config

    @renderer
    def config(self, request, tag):
        tag.fillSlots(cosmos_config=self._config)
        return tag

class ResponseElement(Element):
    loader = XMLFile(os.path.join(htmldir, "response-template.html"))

    def __init__(self, code):
        self._code = code
    
    @renderer
    def code(self, request, tag):
        return self._code

class Provisioner(resource.Resource):
    def __init__(self, reactor, o):
        self.reactor = reactor
        self.opts = o

    @defer.inlineCallbacks
    def build_page(self):
        f = open(cosmosConfigFile(self.opts['home']))
        html = yield flattenString(None, ConfigElement(f.read()))
        defer.returnValue(html)

    def render_GET(self, req):
        d = self.build_page()
        def built(response):
            req.write(response)
            req.finish()
        d.addCallback(built)
        d.addErrback(log.err)
        return server.NOT_DONE_YET

class RequestCode(resource.Resource):
    def __init__(self, reactor, o):
        self.reactor = reactor
        self.opts = o

    @defer.inlineCallbacks
    def got_message(self, client_message, nickname):
        cm = json.loads(client_message.decode("utf-8"))
        mobj = {"type": "pleaseProvision",
                "nickname": nickname,
                "pubkey": cm["pubkey"],
                }
        print("mobj:", mobj)
        m = json.dumps(mobj)
        controller_url = self.opts["controller"]
        # this HTTP request goes to the controller machine, where it should
        # be routed to vat-provisioning.js and the pleaseProvision() method.
        try:
            resp = yield treq.post(controller_url, m.encode('utf-8'),
                                headers={b'Content-Type': [b'application/json']})
        except Exception as e:
            return {"ok": False, "error": str(e)}
        rawResp = yield treq.json_content(resp)
        if not rawResp.get("ok"):
            print("provisioning server error", r)
            return {"ok": False, "error": r.get('rej')}
        r = rawResp['res']
        ingressIndex = r["ingressIndex"]
        f = open(cosmosConfigFile(self.opts['home']))
        config = json.loads(f.read())
        # this message is sent back to setup-solo/src/ag_setup_solo/main.py
        server_message = {
            "ok": True,
            "gci": config['gci'],
            "rpcAddrs": config['rpcAddrs'],
            "chainName": config['chainName'],
            "ingressIndex": ingressIndex,
            }
        print("send server_message", server_message)
        return server_message

    def send_provisioning_response(self, server_message, w):
        sm = json.dumps(server_message).encode("utf-8")
        print("send provisioning response", server_message)
        w.send_message(sm)
        d = w.close()
        d.addCallbacks(lambda _: print("provisioning complete"),
                       lambda f: print("provisioning error", f))

    @defer.inlineCallbacks
    def build_provisioning_response(self, nickname):
        w = wormhole.create(APPID, MAILBOX_URL, self.reactor)
        w.allocate_code()
        code = yield w.get_code()

        d = w.get_message()
        d.addCallback(self.got_message, nickname.decode('utf-8'))
        d.addCallback(self.send_provisioning_response, w)


        html = yield flattenString(None, ResponseElement(code))
        defer.returnValue(html)

    def render_POST(self, req):
        nickname = req.args[b"nickname"][0]
        print(nickname)
        d = self.build_provisioning_response(nickname)
        def built(response):
            req.write(response)
            req.finish()
        d.addCallback(built)
        d.addErrback(log.err)
        return server.NOT_DONE_YET

def run_server(reactor, o):
    print("dir is", __file__)
    root = static.File(htmldir)
    provisioner = Provisioner(reactor, o)
    root.putChild(b"", provisioner)
    root.putChild(b"index.html", provisioner)
    root.putChild(b"request-code", RequestCode(reactor, o))
    site = server.Site(root)
    s = endpoints.serverFromString(reactor, o["listen"])
    s.listen(site)
    print("server running")
    return defer.Deferred()

def main():
    o = Options()
    o.parseOptions()
    if o.subCommand == 'set-cosmos-config':
        try:
            os.mkdir(o['home'])
        except FileExistsError:
            pass
        fname = cosmosConfigFile(o['home'])
        print('Reading %s from stdin; hit Ctrl-D to finish' % fname)
        cfgJson = sys.stdin.read()
        f = open(fname, 'w')
        f.write(cfgJson)
        f.close()
    elif o.subCommand == 'start':
        react(run_server, ({**o, **o.subOptions},))
    else:
        print("Need either 'set-cosmos-config' or 'start'")
        sys.exit(1)