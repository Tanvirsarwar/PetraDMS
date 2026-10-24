import { PetraError } from '@petra/core';
import type { Dispatcher } from './dispatcher';
import { postSale, editSale, voidSale, postSaleReturn, voidSaleReturn, type SaleInput } from '../sales';
import { currentBusinessDate } from './coreServices';
import { loadSettings } from '../settings';
import { clearDraft, getSale, listAreas, listCustomers, listSales, loadDraft, quickAddCustomer, saveArea, saveCustomer, saveDraft } from './salesApp';
import { runPrint } from './printing';

type Body = Omit<SaleInput, 'date' | 'approvedBy'> & { approvalToken?: string };

/** Phase 6: customers, sales, returns, drafts and printing. */
export function registerSalesServices(d: Dispatcher): void {
  const toInput = (session: NonNullable<Dispatcher['session']>, i: Body & { date?: string }, dispatcher: Dispatcher): Omit<SaleInput, 'date'> => {
    // A manager or owner approves their own overrides; staff need a token from `auth:approve`.
    const approvedBy = session.role !== 'staff' ? session.userId : dispatcher.peekApproval(i.approvalToken);
    return {
      customerId: i.customerId, lines: i.lines.map((l) => ({ ...l, discKind: l.discKind ?? null })), discKind: i.discKind ?? null, discValue: i.discValue, paid: i.paid,
      accountId: i.accountId, note: i.note, priceTier: i.priceTier, approvedBy
    };
  };

  d.register('area:list', ({ ctx }) => listAreas(ctx));
  d.register('area:save', ({ ctx, input }) => ({ id: saveArea(ctx, input) }));
  d.register('customer:list', ({ ctx, input }) => listCustomers(ctx, input.includeArchived));
  d.register('customer:save', ({ ctx, input }) => ({ id: saveCustomer(ctx, input) }));
  d.register('customer:quickAdd', ({ ctx, session, input }) => ({ id: quickAddCustomer(ctx, session?.role ?? 'staff', input) }));

  d.register('sale:save', ({ ctx, session, input, dispatcher }) => {
    const r = postSale(ctx, { ...toInput(session!, input, dispatcher), date: input.date, requestId: input.requestId });
    dispatcher.consumeApproval(input.approvalToken);
    clearDraft(ctx, session!.userId);
    return { id: r.id, docNo: r.docNo, total: r.total, paid: r.paid, due: r.due, revision: r.revision, warnings: r.warnings };
  });
  d.register('sale:edit', ({ ctx, session, input, dispatcher }) => {
    const { id, reason } = input;
    const r = editSale(ctx, id, toInput(session!, input, dispatcher), reason);
    dispatcher.consumeApproval(input.approvalToken);
    return { id: r.id, docNo: r.docNo, total: r.total, paid: r.paid, due: r.due, revision: r.revision, warnings: r.warnings };
  });
  d.register('sale:void', ({ ctx, input }) => {
    voidSale(ctx, input.id, input.reason); // the engine refuses closed days
    return null;
  });
  d.register('sale:list', ({ ctx, session, input }) => listSales(ctx, session!.role, currentBusinessDate(ctx, loadSettings(ctx.db)), input));
  d.register('sale:get', ({ ctx, session, input }) => {
    const sale = getSale(ctx, session!.role, input.id);
    if (session!.role === 'staff' && sale.date !== currentBusinessDate(ctx, loadSettings(ctx.db))) throw new PetraError('PERMISSION', 'staff can open today\'s invoices only');
    return sale;
  });
  d.register('sale:return', ({ ctx, input }) => {
    const r = postSaleReturn(ctx, input);
    return { id: r.id, docNo: r.docNo, total: r.total };
  });
  d.register('sale:returnVoid', ({ ctx, input }) => {
    voidSaleReturn(ctx, input.id, input.reason);
    return null;
  });

  d.register('draft:get', ({ ctx, session }) => loadDraft(ctx, session!.userId));
  d.register('draft:save', ({ ctx, session, input }) => {
    saveDraft(ctx, session!.userId, input.payload);
    return null;
  });
  d.register('draft:clear', ({ ctx, session }) => {
    clearDraft(ctx, session!.userId);
    return null;
  });

  d.register('print:run', ({ ctx, session, input, host }) => {
    if (session!.role === 'staff' && input.doc.type === 'statement' && input.doc.kind === 'supplier') throw new PetraError('PERMISSION', 'manager role required');
    return runPrint(ctx, host, session!.role, input);
  });
}
