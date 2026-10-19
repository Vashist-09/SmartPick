export type Parcel={parcel_id:string;parcelId?:string;tracking_id:string;trackingId?:string;parcel_status:string;status?:string;compartment_id:string|null;slot_no:number|null;compartment_no:number|null};
export type Compartment={compartmentId:string;compartmentNo:number;occupancyStatus:string;parcel:null|{parcelId:string;trackingId:string;status:string}};
export type Slot={slotId:string;slotNo:number;slotName:string;status:string;compartments:Compartment[]};
