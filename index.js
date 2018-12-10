module.exports = function ParcelHelper(dispatch) {

    /* 
        States 
    */
    const Idle = 0;
    const PreparingDeletion = 1;
    const PreparingParcels = 2;
    const ClaimingParcels = 3;

    let state = Idle;
    let messageIds = [];

    /* 
        Chat hooks
    */
    dispatch.command.add('getmail', () => {
        startProcedure(PreparingParcels);
    });
    
    dispatch.command.add(['deletemail', 'delmail'], () => {
        startProcedure(PreparingDeletion)
    });
    
    /*
        Populate messageIds array 
        
        Dispatching C_LIST_PARCEL will trigger the server to send S_LIST_PARCEL_EX, with this we can get analyze every message
        in the inbox and store the corresponding message id.
    */
    
    function startProcedure(startState) {
        messageIds = [];
        state = startState;
        checkMail(0);
    }
    
    function checkMail(pageIndex) {
        dispatch.toServer('C_LIST_PARCEL', 2, {
            unk1: 0,
            page: pageIndex,
            filter: 0
        });
    }
    
    dispatch.hook('S_LIST_PARCEL_EX', 1, (event) => {
        
        switch (state) {
            case PreparingDeletion:
                for (let i in event.messages) {
                    // only accept id's of read messages and claimed parcels
                    if (event.messages[i].read == 2) {
                        messageIds.push({id: event.messages[i].id});
                    }
                }	
                
                // check next page
                if (event.currentPage < event.totalPages - 1) {
                    checkMail(event.currentPage + 1);
                }
                else {
                    // no more pages to check, try deleting now
                    if (messageIds.length > 0) {
                        dispatch.toServer('C_DELETE_PARCEL', 2, {
                            messages: messageIds
                        });
                    }
                    else {
                        dispatch.command.message('No messages to delete');
                    }
                    state = Idle;
                
                }
                break;
            
            case PreparingParcels:
                for (let i in event.messages) {
                    // only accept id's of unclaimed parcels
                    if (event.messages[i].type != 0 && event.messages[i].read != 2) {
                        messageIds.push({id: event.messages[i].id});
                    }
                }
                
                // check next page
                if (event.currentPage < event.totalPages - 1) {
                    checkMail(event.currentPage + 1);
                }
                else {
                    if (messageIds.length > 0) {
                        state = ClaimingParcels;
                        requestContract();
                    }
                    else {
                        dispatch.command.message('No parcels to claim');
                        state = Idle;
                    }
                }
                break;
        };
    
    });

    /*  
        Parcels need to request a contract once and then all need to be read before being claimed.
        
        Start:
            C_REQUEST_CONTRACT
            S_REPLY_REQUEST_CONTRACT (or S_REQUEST_CONTRACT ?)
        Loop:
            C_SHOW_PARCEL_MESSAGE
            S_PARCEL_READ_RECV_STATUS ?
            C_RECV_PARCEL
            S_RECV_PARCEL
    */
        
    function requestContract() {
        dispatch.toServer('C_REQUEST_CONTRACT', 1, {
            type: 8
        });
    }
    
    dispatch.hook('S_REPLY_REQUEST_CONTRACT', 1, (event) => {
        if (state == ClaimingParcels) {
            readParcel();
        }
    });
    
    /*
        Parcel claim loop
        
        TODO: Find a better hook than S_PARCEL_READ_RECV_STATUS ??? What happens is it gets triggere twice, once from C_SHOW_PARCEL_MESSAGE and 
        again from S_RECV_PARCEL. So what happens is the S_PARCEL_READ_RECV_STATUS hook funciton will call claimParcel twice on the same parcel.
        This will cause every parcel to be claimed and then immediately fail, do this enough times and the client will disconnect and possibly crash. 
        The current solution is keep track of the parcel id that is currently being processed and ignore the second S_PARCEL_READ_RECV_STATUS execution,
        this is done with the queuedParcel variable.
    */
    let queuedParcel = 0;
    
    function readParcel() {
        if (messageIds.length > 0) {
            queuedParcel = messageIds[messageIds.length-1].id;
            dispatch.toServer('C_SHOW_PARCEL_MESSAGE', 1, {
                id: messageIds[messageIds.length-1].id
            });
        }
        else {
            state = Idle;
        }
    }

    dispatch.hook('S_PARCEL_READ_RECV_STATUS', 2, (event) => {
        if (state == ClaimingParcels ) {
            if (queuedParcel != 0 && queuedParcel == messageIds[messageIds.length-1].id) {
                queuedParcel = 0;
                claimParcel();
            }
        }
    });
    
    function claimParcel() {
        if (messageIds.length > 0) {
            dispatch.toServer('C_RECV_PARCEL', 1, {
                id: messageIds[messageIds.length-1].id
            });
        }
    }
    
    dispatch.hook('S_RECV_PARCEL', 2, (event) => {
        if (state == ClaimingParcels) {
            if (messageIds.length > 0) {
                messageIds.pop();
                readParcel();
            }
            else {
                state = Idle;
            }
        }
    });

}
