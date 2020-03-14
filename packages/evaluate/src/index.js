/* global harden Compartment */
//import makeDefaultEvaluateOptions from '@agoric/default-evaluate-options';
//import { HandledPromise } from '@agoric/eventual-send';
// If we're running inside SwingSet, this SES is synthetic. If not (mostly
// unit tests), we'll import the real SES.
//import { lockdown } from 'ses/dist/ses.cjs.js';
//import { lockdown } from 'ses';
import { lockdown } from '../../ses.esm.js';

function setup() {
    // eslint-disable-next-line no-undefined
    if (typeof Compartment === 'undefined') {
        lockdown({ noTameError: true });
        // that adds Compartment and harden to the globals
    }
    // eslint-disable-next-line no-undefined
    if ((typeof Compartment === 'undefined') || (typeof harden === 'undefined')) {
        throw Error('unable to lockdown(), SES not initialized');
    }
    // eslint-disable-next-line no-undefined
    return { harden, Compartment };
}

/*
function makeEndowments() {
  function req(what) {
    if (what === '@agoric/harden') {
      return harden;
    }
    if (what === 'ses') {
      // The API contract of `lockdown()` is that `harden` and `Compartment`

      // will be available your global scope after `lockdown()` returns. All
      // JS code under SwingSet runs in a SES environment, so those values
      // are always available, even before calling `lockdown()`, so we can
      // return a dummy `lockdown` here.
      function lockdown() {
        // TODO: compare options, throw if they don't match what we did
      }

      return harden({ lockdown });
    }
    throw Error(`unknown require(${what})`);
  }
  const endowments = {
    console: makeConsole(console),
    require: req,
    HandledPromise,
  };
  return harden(endowments);
}
*/

// This is a basic frozen-globals evaluator-with-endowments, which can be
// used both inside and outside of SwingSet. If you need something fancier
// (like sloppyGlobalsMode), use the Compartment API directly (and only run
// inside SwingSet).

export const evaluateProgram = (src, options = {}) => {
  setup();
  // options takes: endowments, transforms, sloppyGlobalsMode
  const { harden, Compartment } = setup();
  const c = new Compartment();
  //harden(c.global);
  return c.evaluate(src, options);
};

// importBundle takes the output of bundle-source, and returns a namespace
// object (with .default, and maybe other properties for named exports)

export async function importBundle(bundle, options = {}) {
  setup();
  const { filePrefix, endowments = {}, ...compartmentOptions } = options;
  const { source, sourceMap, moduleFormat } = bundle;
  if (moduleFormat === 'getExport') {
    // The 'getExport' format is a string which defines a wrapper function
    // named `getExport()`. This function provides a `module` to the
    // linearized source file, executes that source, then returns
    // `module.exports`. To get the function object out of a program-mode
    // evaluation, we must wrap the function definition in parentheses
    // (making it an expression). We also want to append the `sourceMap`
    // comment so `evaluate` can attach useful debug information. Finally, to
    // extract the namespace object, we need to invoke this function.
    const c = new Compartment(endowments, {}, compartmentOptions);
    const actualSource = `(${source})\n${sourceMap}`;
    const namespace = c.evaluate(actualSource)();
    // namespace.default has the default export
    return namespace;
  }
  if (moduleFormat === 'nestedEvaluate') {
    // The 'nestedEvaluate' format is similar, except the wrapper function
    // (now named `getExportWithNestedEvaluate`) wraps more than a single
    // linearized string. Each source module is processed (converting
    // `import` into `require`) and added to a table named `sourceBundle`.
    // Each module will be evaluated separately (so they can get distinct
    // sourceMap strings), using a mandatory endowment named
    // `nestedEvaluate`. The wrapper function should be called with
    // `filePrefix`, which will be used as the sourceMap for the top-level
    // module. The sourceMap name for other modules will be derived from
    // `filePrefix` and the relative import path of each module.
    let c;
    function nestedEvaluate(source) {
      return c.evaluate(source);
    }
    c = new Compartment({ nestedEvaluate, ...endowments}, {}, compartmentOptions);
    harden(c.global);
    const actualSource = `(${source})\n${sourceMap}`;
    const namespace = c.evaluate(actualSource)(filePrefix);
    // namespace.default has the default export
    return namespace;
  }
  throw Error(`unrecognized moduleFormat '${moduleFormat}'`);
}
