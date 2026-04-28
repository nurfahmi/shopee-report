// Single source of truth for per-entry payout breakdown math.
// Reused by MY admin bank cards, detail page, transfer page, PDF reports.
//
// Deduction model (matches MY admin's manual reconciliation sheet):
//   ALL percentage deductions are computed from GROSS (Total Sale on Invoice).
//
//   gross
//   − Shopee service fee   (1% × gross)
//   − Shopee SST           (8% × shopeeService = 0.08% × gross)
//   − MY admin fee         (myAdmin% × gross)
//   − MY HQ fee            (myHQ%    × gross)
//   − Bank holder share    (general% × gross)   ← bank holder's commission
//   − ID admin fee         (idAdmin% × gross)
//   = netToStudio          (the residue)
//
// Pipeline semantics in MY admin's workflow:
//   netAfterShopee = what physically lands in the bank holder's account.
//   needToPay      = what MY admin asks the bank holder to return  (= gross × (1 − general%))
//   netToTransfer  = what MY admin forwards to ID admin            (= needToPay − myAdmin − myHQ)
//   netToStudio    = final amount the studio receives              (= netToTransfer − idAdmin)
//
// (Note: needToPay ignores Shopee fees by design — that's the manual sheet's
//  accounting convention. The bank holder's actual cash on hand is netAfterShopee.)

const SHOPEE_SERVICE_PCT = 0.01;
const SHOPEE_SST_PCT     = 0.08;

function num(x) { return parseFloat(x) || 0; }

function breakdownEntry(entry, deductions = {}) {
  const gross = num(entry.payout_amount);
  const shopeeService = gross * SHOPEE_SERVICE_PCT;
  const shopeeSST     = shopeeService * SHOPEE_SST_PCT;
  const netAfterShopee = gross - shopeeService - shopeeSST;

  const myPct  = num(deductions.myAdmin);
  const hqPct  = num(deductions.myHQ);
  const genPct = num(deductions.general);
  const idPct  = num(deductions.idAdmin);

  // Every deduction is a slice of GROSS (matches manual report).
  const myAdminFee      = gross * myPct  / 100;
  const myHQFee         = gross * hqPct  / 100;
  const bankHolderShare = gross * genPct / 100;
  const idAdminFee      = gross * idPct  / 100;

  const totalFees       = shopeeService + shopeeSST + myAdminFee + myHQFee + bankHolderShare + idAdminFee;
  // Need-to-pay = gross − bank holder share. (This is what MY admin requests back.)
  const needToPay       = gross - bankHolderShare;
  // What flows to ID admin = needToPay − MY/HQ cut − Shopee fees.
  // (Manual report convention: Shopee fees are absorbed from MY admin's pool,
  //  so all six slices — Shopee + SST + Admin + HQ + Per Person + Balance — sum to gross.)
  const netToTransfer   = needToPay - myAdminFee - myHQFee - shopeeService - shopeeSST;
  // Final to studio after ID admin keeps their cut.
  const netToStudio     = netToTransfer - idAdminFee;

  return {
    gross,
    shopeeService,
    shopeeSST,
    netAfterShopee,
    myAdminFee,
    myHQFee,
    bankHolderShare,
    idAdminFee,
    totalFees,
    needToPay,
    netToTransfer,
    netToStudio,
  };
}

module.exports = { breakdownEntry };
