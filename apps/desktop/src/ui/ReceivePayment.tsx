import { useState } from 'react';
import type { CustomerDto } from '@petra/core';
import { CustomerPicker } from './CustomerPicker';
import { PaymentModal } from './PartyLedger';

/** F5: choose a customer, then receive a payment. Used by the dashboard quick action, the customer list and the global shortcut. */
export function ReceivePaymentFlow({ open, onClose, onDone, customer }: { open: boolean; onClose: () => void; onDone?: () => void; customer?: CustomerDto | null }) {
  const [picked, setPicked] = useState<CustomerDto | null>(null);
  const c = customer ?? picked;
  const close = () => {
    setPicked(null);
    onClose();
  };
  return (
    <>
      <CustomerPicker open={open && !c} allowWalkIn={false} onClose={close} onPick={(x) => setPicked(x)} />
      {c && <PaymentModal open={open} kind="customer" partyId={c.id} partyName={c.name} balance={c.balance} onClose={close} onDone={() => { setPicked(null); onDone?.(); onClose(); }} />}
    </>
  );
}
