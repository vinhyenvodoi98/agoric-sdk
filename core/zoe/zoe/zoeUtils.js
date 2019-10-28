import harden from '@agoric/harden';
import { E } from '@agoric/eventual-send';

import makePromise from '../../../util/makePromise';
import { insist } from '../../../util/insist';

// These utilities are used within Zoe itself. Importantly, there is
// no ambient authority for these utilities. Any authority must be
// passed in, making it easy to see which functions can affect what.

const mintEscrowReceiptPayment = (
  escrowReceiptMint,
  offerHandle,
  offerRules,
) => {
  const escrowReceiptExtent = harden({
    offerHandle,
    offerRules,
  });
  const escrowReceiptPurse = escrowReceiptMint.mint(escrowReceiptExtent);
  const escrowReceiptPaymentP = escrowReceiptPurse.withdrawAll();
  return escrowReceiptPaymentP;
};

const escrowPayment = async (payoutRule, offerPayment, purse, extentOps) => {
  // if the user's contractual understanding includes
  // "offerExactly" or "offerAtMost", make sure that they have supplied a
  // payment with that exact balance
  if (['offerExactly', 'offerAtMost'].includes(payoutRule.kind)) {
    const { extent } = await E(purse).depositExactly(
      payoutRule.assetDesc,
      offerPayment,
    );
    return extent;
  }
  insist(
    offerPayment === undefined,
  )`payment was included, but the rule kind was ${payoutRule.kind}`;
  return extentOps.empty();
};

const insistValidPayoutRuleKinds = payoutRules => {
  const acceptedKinds = [
    'offerExactly',
    'offerAtMost',
    'wantExactly',
    'wantAtLeast',
  ];
  for (const payoutRule of payoutRules) {
    insist(
      acceptedKinds.includes(payoutRule.kind),
    )`kind ${payoutRule.kind} is not one of the accepted kind`;
  }
};

const insistValidExitRule = exitRule => {
  const acceptedExitRuleKinds = [
    'noExit',
    'onDemand',
    'afterDeadline',
    // 'onDemandAfterDeadline', // not yet supported
  ];

  insist(
    acceptedExitRuleKinds.includes(exitRule.kind),
  )`exitRule.kind ${exitRule.kind} is not one of the accepted options`;
};

const escrowOffer = async (
  recordOffer,
  recordAssay,
  offerRules,
  offerPayments,
) => {
  const result = makePromise();
  const { payoutRules, exit = { kind: 'onDemand' } } = offerRules;

  insistValidPayoutRuleKinds(payoutRules);
  insistValidExitRule(exit);

  // Escrow the payments and store the assays from the payoutRules. We
  // assume that the payoutRules has elements for each expected assay,
  // and none are undefined.
  // TODO: handle bad offers more robustly
  const extents = await Promise.all(
    payoutRules.map(async (payoutRule, i) => {
      const { assay } = payoutRule.assetDesc.label;
      const { purse, extentOps } = await recordAssay(assay);
      return escrowPayment(payoutRule, offerPayments[i], purse, extentOps);
    }),
  );

  const assays = payoutRules.map(payoutRule => {
    const { assay } = payoutRule.assetDesc.label;
    return assay;
  });

  const offerHandle = harden({});

  recordOffer(offerHandle, offerRules, extents, assays, result);

  return harden({
    offerHandle,
    result,
  });
};

const escrowEmptyOffer = (recordOffer, assays, labels, extentOpsArray) => {
  const offerHandle = harden({});
  const payoutRules = labels.map((label, i) =>
    harden({
      kind: 'wantAtLeast',
      assetDesc: {
        label,
        extent: extentOpsArray[i].empty(),
      },
    }),
  );
  const offerRules = harden({
    payoutRules,
    exitRule: {
      kind: 'onDemand',
    },
  });
  const extents = extentOpsArray.map(extentOps => extentOps.empty());
  const result = makePromise();

  // has side effects
  recordOffer(offerHandle, offerRules, extents, assays, result);

  return harden({
    offerHandle,
    result,
  });
};

const makePayments = (purses, assetDescsMatrix) => {
  const paymentsMatrix = assetDescsMatrix.map(row => {
    const payments = Promise.all(
      row.map((assetDesc, i) => E(purses[i]).withdraw(assetDesc, 'payout')),
    );
    return payments;
  });
  return Promise.all(paymentsMatrix);
};

// an array of empty extents per extentOps
const makeEmptyExtents = extentOpsArray =>
  extentOpsArray.map(extentOps => extentOps.empty());

const makeAssetDesc = (extentOps, label, allegedExtent) => {
  extentOps.insistKind(allegedExtent);
  return harden({
    label,
    extent: allegedExtent,
  });
};

// Transform a extentsMatrix to a matrix of assetDescs given an array
// of the associated assetDescOps.
const toAssetDescMatrix = (extentOps, labels, extentsMatrix) =>
  extentsMatrix.map(extents =>
    extents.map((extent, i) => makeAssetDesc(extentOps[i], labels[i], extent)),
  );

// Note: offerHandles must be for the same assays.
const completeOffers = async (adminState, readOnlyState, offerHandles) => {
  const { inactive } = readOnlyState.getStatusFor(offerHandles);
  if (inactive.length > 0) {
    throw new Error('offer has already completed');
  }
  adminState.setOffersAsInactive(offerHandles);
  const [assays] = readOnlyState.getAssaysFor(offerHandles);
  const extents = readOnlyState.getExtentsFor(offerHandles);
  const extentOps = readOnlyState.getExtentOpsArrayForAssays(assays);
  const labels = readOnlyState.getLabelsForAssays(assays);
  const assetDescs = toAssetDescMatrix(extentOps, labels, extents);
  const purses = adminState.getPurses(assays);
  const payments = await makePayments(purses, assetDescs);
  const results = adminState.getResultsFor(offerHandles);
  results.map((result, i) => result.res(payments[i]));
  adminState.removeOffers(offerHandles);
};

export {
  escrowEmptyOffer,
  escrowOffer,
  mintEscrowReceiptPayment,
  completeOffers,
  makeEmptyExtents,
  makeAssetDesc,
  toAssetDescMatrix,
};