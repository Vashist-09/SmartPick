import type { Slot } from '../types';

export function CompartmentGrid({ slots }: { slots: Slot[] | null }) {
  const configured = slots !== null && slots.length === 3 && slots.every(slot => slot.compartments.length === 2);
  const free = slots?.reduce((n, s) => n + (s.status === 'ACTIVE' ? s.compartments.filter(c => c.occupancyStatus === 'EMPTY').length : 0), 0) ?? 0;

  return <section className="panel inventory" aria-labelledby="inventory-title" aria-busy={slots === null}>
    <div className="section-heading">
      <div><span className="eyebrow">LIVE INVENTORY</span><h2 id="inventory-title">Compartment map</h2></div>
      <span className="refresh">{slots === null ? 'Loading…' : `${slots.length} slots · ${free} free`}</span>
    </div>
    {!configured && slots !== null && slots.length > 0 && <p className="layout-warning">Database layout mismatch: expected 3 slots with 2 compartments each; currently showing the records returned by the database.</p>}
    {slots !== null && slots.length === 0 && <p className="hint">No slots are configured in the database yet.</p>}
    <div className="slot-grid">
      {slots === null && [1, 2, 3].map(n => <div className="slot-card skeleton" key={n} aria-hidden="true"><span /><span /><span /></div>)}
      {slots?.map(slot => <article className="slot-card" key={slot.slotId}>
        <header><strong>Slot {slot.slotNo}</strong><span>{slot.slotName}</span><i className={slot.status === 'ACTIVE' ? 'online' : ''} aria-label={slot.status === 'ACTIVE' ? 'Active' : 'Inactive'} /></header>
        <div className="compartments" aria-label={`Slot ${slot.slotNo} compartments`}>
          {slot.compartments.map(compartment => <div className={`compartment ${compartment.occupancyStatus === 'OCCUPIED' ? 'occupied' : compartment.occupancyStatus === 'EMPTY' ? '' : 'offline'}`} key={compartment.compartmentId}>
            <span className="comp-no">Compartment {compartment.compartmentNo}</span>
            <b>{compartment.occupancyStatus === 'OCCUPIED' ? 'In use' : compartment.occupancyStatus === 'EMPTY' ? 'Available' : 'Offline'}</b>
            {compartment.parcel && <small title={compartment.parcel.trackingId}>{compartment.parcel.trackingId}</small>}
          </div>)}
        </div>
      </article>)}
    </div>
  </section>;
}
