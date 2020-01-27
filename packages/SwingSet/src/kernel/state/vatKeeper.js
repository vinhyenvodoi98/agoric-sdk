import harden from '@agoric/harden';
import Nat from '@agoric/nat';
import { insist } from '../../insist';
import { parseKernelSlot } from '../parseKernelSlots';
import { makeVatSlot, parseVatSlot } from '../../parseVatSlots';
import { insistVatID } from '../id';
import kdebug from '../kdebug';

// makeVatKeeper is a pure function: all state is kept in the argument object

// TODO: tests rely on these numbers and haven't been updated to use names.
const FIRST_OBJECT_ID = 50;
const FIRST_PROMISE_ID = 60;
const FIRST_DEVICE_ID = 70;
const FIRST_TRANSCRIPT_ID = 0;

export function initializeVatState(storage, vatID) {
  storage.set(`${vatID}.o.nextID`, `${FIRST_OBJECT_ID}`);
  storage.set(`${vatID}.p.nextID`, `${FIRST_PROMISE_ID}`);
  storage.set(`${vatID}.d.nextID`, `${FIRST_DEVICE_ID}`);
  storage.set(`${vatID}.t.nextID`, `${FIRST_TRANSCRIPT_ID}`);
}

export function makeVatKeeper(
  storage,
  vatID,
  addKernelObject,
  addKernelPromise,
) {
  insistVatID(vatID);

  function mapVatSlotToKernelSlot(vatSlot) {
    insist(`${vatSlot}` === vatSlot, 'non-string vatSlot');
    const vatKey = `${vatID}.c.${vatSlot}`;
    if (!storage.has(vatKey)) {
      const { type, allocatedByVat } = parseVatSlot(vatSlot);

      if (allocatedByVat) {
        let kernelSlot;
        if (type === 'object') {
          kernelSlot = addKernelObject(vatID);
        } else if (type === 'device') {
          throw new Error(`normal vats aren't allowed to export device nodes`);
        } else if (type === 'promise') {
          kernelSlot = addKernelPromise(vatID);
        } else {
          throw new Error(`unknown type ${type}`);
        }
        const kernelKey = `${vatID}.c.${kernelSlot}`;
        storage.set(kernelKey, vatSlot);
        storage.set(vatKey, kernelSlot);
        kdebug(`Mapping ${kernelKey}<=>${vatKey}`);
      } else {
        // the vat didn't allocate it, and the kernel didn't allocate it
        // (else it would have been in the c-list), so it must be bogus
        throw new Error(`unknown vatSlot ${vatSlot}`);
      }
    }

    return storage.get(vatKey);
  }

  function mapKernelSlotToVatSlot(kernelSlot) {
    insist(`${kernelSlot}` === kernelSlot, 'non-string kernelSlot');
    const kernelKey = `${vatID}.c.${kernelSlot}`;
    if (!storage.has(kernelKey)) {
      const { type } = parseKernelSlot(kernelSlot);

      let id;
      if (type === 'object') {
        id = Nat(Number(storage.get(`${vatID}.o.nextID`)));
        storage.set(`${vatID}.o.nextID`, `${id + 1}`);
      } else if (type === 'device') {
        id = Nat(Number(storage.get(`${vatID}.d.nextID`)));
        storage.set(`${vatID}.d.nextID`, `${id + 1}`);
      } else if (type === 'promise') {
        id = Nat(Number(storage.get(`${vatID}.p.nextID`)));
        storage.set(`${vatID}.p.nextID`, `${id + 1}`);
      } else {
        throw new Error(`unknown type ${type}`);
      }
      const vatSlot = makeVatSlot(type, false, id);

      const vatKey = `${vatID}.c.${vatSlot}`;
      storage.set(vatKey, kernelSlot);
      storage.set(kernelKey, vatSlot);
    }

    return storage.get(kernelKey);
  }

  function* getTranscript() {
    for (const value of storage.getPrefixedValues(`${vatID}.t.`)) {
      yield JSON.parse(value);
    }
  }

  function addToTranscript(msg) {
    const id = Nat(Number(storage.get(`${vatID}.t.nextID`)));
    storage.set(`${vatID}.t.nextID`, `${id + 1}`);
    storage.set(`${vatID}.t.${id}`, JSON.stringify(msg));
  }

  function vatStats() {
    function getStringAsNat(ostr) {
      return Nat(Number(storage.get(ostr)));
    }

    const objectCount = getStringAsNat(`${vatID}.o.nextID`) - FIRST_OBJECT_ID;
    const promiseCount = getStringAsNat(`${vatID}.p.nextID`) - FIRST_PROMISE_ID;
    const deviceCount = getStringAsNat(`${vatID}.d.nextID`) - FIRST_DEVICE_ID;
    const transcriptCount =
      storage.get(`${vatID}.t.nextID`) - FIRST_TRANSCRIPT_ID;
    return harden({
      objectCount: Nat(objectCount),
      promiseCount: Nat(promiseCount),
      deviceCount: Nat(deviceCount),
      transcriptCount: Nat(Number(transcriptCount)),
    });
  }

  // pretty print for logging and testing
  function dumpState() {
    const res = [];
    const prefix = `${vatID}.c.`;
    for (const k of storage.getKeys(prefix, `${vatID}.c/`)) {
      if (k.startsWith(prefix)) {
        const slot = k.slice(prefix.length);
        if (!slot.startsWith('k')) {
          const vatSlot = slot;
          const kernelSlot = storage.get(k);
          res.push([kernelSlot, vatID, vatSlot]);
        }
      }
    }
    return harden(res);
  }

  return harden({
    mapVatSlotToKernelSlot,
    mapKernelSlotToVatSlot,
    getTranscript,
    addToTranscript,
    vatStats,
    dumpState,
  });
}
