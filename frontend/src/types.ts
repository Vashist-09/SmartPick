export type Account = {
    account_id: string;
    email: string;
    full_name: string;
    role: 'STUDENT' | 'OPERATOR';
};
export type Parcel = {
    parcel_id: string;
    tracking_id: string;
    parcel_status: string;
    workflow_status: string;
    payment_type: 'PREPAID' | 'COD';
    payment_status: string;
    registration_no: string;
    student_name: string;
    compartment_id: string | null;
    slot_no: number | null;
    compartment_no: number | null;
};
export type Compartment = {
    compartmentId: string;
    compartmentNo: number;
    occupancyStatus: string;
    parcel: null | {
        parcelId: string;
        trackingId: string;
        status: string;
    };
};
export type Slot = {
    slotId: string;
    slotNo: number;
    slotName: string;
    status: string;
    compartments: Compartment[];
};
export type Pickup = {
    parcel_status: string;
    workflow_status: string;
    collected_at: string | null;
    pickup_id: string;
    parcel_id: string;
    tracking_id: string;
    status: string;
    command_status: string;
    expires_at: string;
    completed_at: string | null;
    slot_no: number;
    compartment_no: number;
};
