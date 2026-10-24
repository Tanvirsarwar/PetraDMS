import type { Dispatcher } from './dispatcher';
import { archiveProduct, listLookups, listMoneyAccounts, listProducts, listSuppliers, partyLedger, saveLookup, saveProduct, saveSupplier } from './catalog';
import { assertManager, getPurchase, listAdjustments, listBatches, listPurchases, stockAlerts, stockMovements } from './inbound';
import { currentBusinessDate } from './coreServices';
import { archiveProducts, deleteProducts, previewProductsDelete } from '../productsBulk';
import { loadSettings } from '../settings';
import { postPurchase, postPurchaseReturn, voidPurchase, voidPurchaseReturn } from '../purchases';
import { postPayment, voidPayment } from '../money';
import { postStockAdjustment, voidStockAdjustment } from '../adjustments';
import { unlinkProducts, setSupplierProduct } from '../supplierProducts';
import { applyPrices, checkInvoiceRef, clearPurchaseDraft, linkSelection, listSupplierProducts, loadPurchaseDraft, priceSuggestions, savePurchaseDraft } from './boxApp';

/** Phase 5: catalog, suppliers, purchases, stock, batches and adjustments. */
export function registerCatalogServices(d: Dispatcher): void {
  d.register('catalog:products', ({ ctx, session, input }) => listProducts(ctx, session!.role, input.includeArchived));
  d.register('catalog:productSave', ({ ctx, input }) => ({ id: saveProduct(ctx, input) }));
  d.register('catalog:productArchive', ({ ctx, input }) => {
    archiveProduct(ctx, input.id, input.archived);
    return null;
  });
  d.register('catalog:productsArchive', ({ ctx, input }) => archiveProducts(ctx, input.ids, input.archived));
  d.register('catalog:productsDeletePreview', ({ ctx, input }) => previewProductsDelete(ctx, input.ids));
  d.register('catalog:productsDelete', ({ ctx, input }) => deleteProducts(ctx, input.ids, input.confirm));
  d.register('catalog:lookups', ({ ctx }) => listLookups(ctx));
  d.register('catalog:lookupSave', ({ ctx, input }) => ({ id: saveLookup(ctx, input) }));
  d.register('catalog:suppliers', ({ ctx, input }) => listSuppliers(ctx, input.includeArchived));
  d.register('catalog:supplierSave', ({ ctx, input }) => ({ id: saveSupplier(ctx, input) }));

  d.register('money:accounts', ({ ctx }) => listMoneyAccounts(ctx));
  d.register('party:ledger', ({ ctx, session, input }) => {
    if (input.kind !== 'customer') assertManager(session?.role);
    return partyLedger(ctx, input.kind, input.id, input.from, input.to);
  });
  d.register('payment:save', ({ ctx, session, input }) => {
    if (input.partyKind === 'supplier') assertManager(session?.role);
    return postPayment(ctx, { partyKind: input.partyKind, partyId: input.partyId, amount: input.amount, date: input.date, accountId: input.accountId, reference: input.reference, note: input.note, requestId: input.requestId });
  });
  d.register('payment:void', ({ ctx, input }) => {
    voidPayment(ctx, input.id, input.reason);
    return null;
  });

  d.register('purchase:save', ({ ctx, session, input }) => {
    const r = postPurchase(ctx, input);
    clearPurchaseDraft(ctx, session!.userId);
    return r;
  });
  d.register('purchase:checkRef', ({ ctx, input }) => checkInvoiceRef(ctx, input.supplierId, input.ref));
  d.register('purchase:draftGet', ({ ctx, session }) => loadPurchaseDraft(ctx, session!.userId));
  d.register('purchase:draftSave', ({ ctx, session, input }) => {
    savePurchaseDraft(ctx, session!.userId, input.payload);
    return null;
  });
  d.register('purchase:draftClear', ({ ctx, session }) => {
    clearPurchaseDraft(ctx, session!.userId);
    return null;
  });
  d.register('purchase:priceSuggest', ({ ctx, input }) => priceSuggestions(ctx, input.id));
  d.register('purchase:applyPrices', ({ ctx, input }) => ({ updated: applyPrices(ctx, input.changes) }));
  d.register('supplier:products', ({ ctx, input }) => listSupplierProducts(ctx, input.supplierId));
  d.register('supplier:link', ({ ctx, input }) => linkSelection(ctx, input));
  d.register('supplier:unlink', ({ ctx, input }) => ({ removed: unlinkProducts(ctx, input.supplierId, input.productIds) }));
  d.register('supplier:linkEdit', ({ ctx, input }) => {
    setSupplierProduct(ctx, input.supplierId, input.productId, { defaultPackId: input.defaultPackId, lastCost: input.lastCost });
    return null;
  });
  d.register('purchase:list', ({ ctx, input }) => listPurchases(ctx, input));
  d.register('purchase:get', ({ ctx, input }) => getPurchase(ctx, input.id));
  d.register('purchase:void', ({ ctx, input }) => {
    voidPurchase(ctx, input.id, input.reason);
    return null;
  });
  d.register('purchase:return', ({ ctx, input }) => postPurchaseReturn(ctx, input));
  d.register('purchase:returnVoid', ({ ctx, input }) => {
    voidPurchaseReturn(ctx, input.id, input.reason);
    return null;
  });

  d.register('stock:movements', ({ ctx, session, input }) => stockMovements(ctx, session!.role, input));
  d.register('stock:batches', ({ ctx, input }) => listBatches(ctx, currentBusinessDate(ctx, loadSettings(ctx.db)), input));
  d.register('stock:alerts', ({ ctx, input }) => stockAlerts(ctx, currentBusinessDate(ctx, loadSettings(ctx.db)), input.soonDays));
  d.register('stock:adjust', ({ ctx, input }) => postStockAdjustment(ctx, input));
  d.register('stock:adjustments', ({ ctx, session, input }) => listAdjustments(ctx, session!.role, input));
  d.register('stock:adjustVoid', ({ ctx, input }) => {
    voidStockAdjustment(ctx, input.id, input.reason);
    return null;
  });
}

