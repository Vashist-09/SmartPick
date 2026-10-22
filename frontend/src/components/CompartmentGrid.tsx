import type { Slot } from '../types';

export function CompartmentGrid({ slots }: { slots: Slot[] }) {
  const configured = slots.length === 3 && slots.every(slot => slot.compartments.length === 2);

  return <section className="panel inventory">
    <div className="section-heading">
      <div><span className="eyebrow">LIVE INVENTORY</span><h2>Compartment map</h2></div>
      <span className="refresh">{slots.length ? `${slots.length} slots` : 'Loading…'}</span>
    </div>
    {!configured && slots.length > 0 && <p className="layout-warning">Database layout mismatch: expected 3 slots with 2 compartments each; currently showing the records returned by the database.</p>}
    <div className="slot-grid">
      {slots.map(slot => <article className="slot-card" key={slot.slotId}>
        <header><strong>Slot {slot.slotNo}</strong><span>{slot.slotName}</span><i className={slot.status === 'ACTIVE' ? 'online' : ''} /></header>
        <div className="compartments" aria-label={`Slot ${slot.slotNo} shelves`}>
          {slot.compartments.map(compartment => <div className={`compartment ${compartment.occupancyStatus === 'OCCUPIED' ? 'occupied' : ''}`} key={compartment.compartmentId}>
            <span className="comp-no">Shelf {compartment.compartmentNo}</span>
            <b>{compartment.occupancyStatus === 'OCCUPIED' ? 'In use' : compartment.occupancyStatus === 'EMPTY' ? 'Available' : 'Offline'}</b>
            {compartment.parcel && <small>{compartment.parcel.trackingId}</small>}
          </div>)}
        </div>
      </article>)}
    </div>
  </section>;
}
