// const socket = new WebSocket("ws://localhost:8765");
const socket = new WebSocket(
    "wss://kyc-video-call-server.onrender.com"
);
const params = new URLSearchParams(window.location.search);

const role = params.get("role");
const callIdFromUrl = params.get("call_id");

let callId = callIdFromUrl || null;

function generateCallId() {
    return crypto.randomUUID();
}

document.getElementById("role").textContent = role === "agent" ? "🧑‍💼 Agent" : "👤 Customer";

const statusDot  = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");

const STATUS = {
    idle:       { label: "Ready",       cls: "" },
    calling:    { label: "Calling...",  cls: "" },
    ringing:    { label: "Incoming...", cls: "" },
    connecting: { label: "Connecting",  cls: "" },
    connected:  { label: "Live",        cls: "connected" },
    ended:      { label: "Call Ended",  cls: "ended" },
};

function updateStatusUI(state) {
    const s = STATUS[state] || STATUS.idle;
    statusText.textContent = s.label;
    statusDot.className = "status-dot " + s.cls;
}

function showEndCallBtn(show) {
    const startBtn = document.getElementById("startCall");
    const endBtn   = document.getElementById("endCall");
    if (role === "customer") {
        startBtn.style.display = "none";
        endBtn.style.display   = show ? "" : "none";
    } else {
        startBtn.style.display = show ? "none" : "";
        endBtn.style.display   = show ? ""     : "none";
    }
}

function hideVideoPlaceholder(videoId, placeholderId) {
    const vid = document.getElementById(videoId);
    const ph  = document.getElementById(placeholderId);
    if (vid.srcObject) ph.style.display = "none";
    else               ph.style.display = "";
}


// --------------------------------
// WebRTC Peer Connection
// --------------------------------
let peerConnection;
function createPeerConnection() {
    console.log("Creating new PeerConnection...");
    const pc = new RTCPeerConnection({
        iceServers: [
            {
                urls: "stun:stun.l.google.com:19302"
            }
        ]
    });

    // ICE Connection State
    pc.oniceconnectionstatechange = () => {
        console.log(
            "ICE Connection State:",
            pc.iceConnectionState
        );
    };

    pc.onconnectionstatechange = () => {
        console.log(
            "WebRTC Connection State:",
            pc.connectionState
        );
        if (pc.connectionState === "connected") {
            setCallState("connected");
        }
        if (pc.connectionState === "failed") {
            setCallState("ended");
        }
        if (pc.connectionState === "closed") {
            setCallState("ended");
        }
    };

    // Remote Track
    pc.ontrack = (event) => {
        console.log(
            "REMOTE TRACK RECEIVED:",
            event
        );
        const remoteVideo =
            document.getElementById("remoteVideo");
        remoteVideo.srcObject = event.streams[0];
        hideVideoPlaceholder("remoteVideo", "remotePlaceholder");
        console.log("Remote stream attached to video element");
    };

    // ICE Gathering State
    pc.onicegatheringstatechange = () => {
        console.log(
            "ICE Gathering State:",
            pc.iceGatheringState
        );
    };

    // ICE Candidate
    pc.onicecandidate = (event) => {
        console.log("ICE EVENT:", event);
        if (event.candidate) {
            console.log(
                "ICE CANDIDATE:",
                event.candidate.candidate
            );
            socket.send(JSON.stringify({
                type: "candidate",
                call_id: callId,
                candidate: event.candidate
            }));

        } else {
            console.log(
                "ICE GATHERING COMPLETE"
            );
        }
    };
    return pc;
}

// ICE candidate queue
let pendingCandidates = [];
let callState = "idle";

function setCallState(newState) {
    callState = newState;
    console.log("CALL STATE:", callState);
    updateStatusUI(newState);
    showEndCallBtn(newState !== "idle" && newState !== "ended");
}

async function addPendingCandidates() {
    console.log(
        "Adding pending ICE candidates:",
        pendingCandidates.length
    );

    for (const candidate of pendingCandidates) {
        await peerConnection.addIceCandidate(candidate);
        console.log("Pending ICE Candidate added");
    }

    pendingCandidates = [];
}

// Create initial PeerConnection
peerConnection = createPeerConnection();

// --------------------------------
// Local Media Stream ############### completely unlearned
// --------------------------------

let localStream;

async function startCamera() {
    console.log("Requesting camera and microphone...");
    localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
    });
    console.log("Camera and microphone access granted");
    console.log("Local MediaStream:", localStream);
    console.log(
        "Video Tracks:",
        localStream.getVideoTracks()
    );
    console.log(
        "Audio Tracks:",
        localStream.getAudioTracks()
    );


    // Show local camera in the browser
    const localVideo = document.getElementById("localVideo");
    localVideo.srcObject = localStream;
    hideVideoPlaceholder("localVideo", "localPlaceholder");
    console.log("Local camera attached to video element");

    // Add local media tracks to WebRTC connection
    localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
        console.log("Track added to PeerConnection:", track.kind);

});
}

// ############################ Till Here Unlearned ########################3


// --------------------------------
// WebSocket connected
// --------------------------------
showEndCallBtn(false);

socket.onopen = async () => {
    console.log("Connected to signaling server");
    updateStatusUI("idle");
    socket.send(JSON.stringify({
        type: "register",
        role: role
    }));
    console.log("Registered as:", role);

    // Customer opened a unique KYC call link
    if (role === "customer" && callId) {
        socket.send(JSON.stringify({
            type: "call_link_opened",
            call_id: callId
        }));
        console.log("Call link opened:", callId);
    }

    if (role === "agent") {
        console.log("Waiting for Agent to start call");
    } else {
        console.log("Waiting for incoming call");
    }
};


// --------------------------------
// Agent: Create SDP Offer
// --------------------------------
async function createOffer() {
    console.log("Creating SDP Offer...");
    const offer = await peerConnection.createOffer();
    console.log("OFFER SDP:", offer.sdp);
    await peerConnection.setLocalDescription(offer);
    console.log("LOCAL SDP:", peerConnection.localDescription);
    console.log("SDP Offer created");
    socket.send(JSON.stringify({
        type: "offer",
        call_id: callId,
        sdp: offer.sdp
    }));

    console.log("SDP Offer sent");
}


// --------------------------------
// Receive signaling messages
// --------------------------------
socket.onmessage = async (event) => {
    const message = JSON.parse(event.data);
    console.log("Received:", message.type);

    if (message.type === "error") {
        console.log("SERVER ERROR:", message);
        return;
    }

    // ----------------------------
    // Customer receives call invitation
    // ----------------------------
    if (message.type === "call_invitation") {
        console.log("CALL INVITATION RECEIVED ON THIS DEVICE");
        console.log("Call ID:", message.call_id);

        callId = message.call_id;

        setCallState("ringing");

        const incomingCall = document.getElementById("incomingCall");
        console.log("incomingCall element:", incomingCall);
        incomingCall.style.display = "flex";

        return;
    }

    // ----------------------------
    // Agent receives accept_call
    // ----------------------------
    if (message.type === "accept_call") {

        console.log("CALL ACCEPTED BY CUSTOMER");

        if (message.call_id !== callId) {
            console.log("Ignoring accept for different call");
            return;
        }

        setCallState("connecting");

        await startCamera();

        await createOffer();

        return;
    }


    if (message.type === "reject_call") {

        console.log("CALL REJECTED BY CUSTOMER");

        if (message.call_id !== callId) {
            console.log("Ignoring reject for different call");
            return;
        }

        console.log(
            "Customer rejected call:",
            message.call_id
        );

        setCallState("idle");

        callId = null;

        console.log("Agent returned to idle state");

        return;
    }

    // ----------------------------
    // Other participant ended call
    // ----------------------------
    if (message.type === "hangup") {

        if (message.call_id !== callId) {
            console.log(
                "Ignoring hangup for different call"
            );
            return;
        }

        console.log(
            "Other participant ended the call"
        );
        endCall();
        return;
    }

    if (message.type === "error") {
        console.log("SERVER ERROR:", message);
        return;
    }

    if (message.type === "candidate") {

        console.log(
            "Received ICE Candidate"
        );


        // Ignore candidate from another call
        if (message.call_id !== callId) {

            console.log(
                "Ignoring ICE candidate for different call:",
                message.call_id
            );

            return;
        }


        // PeerConnection does not exist yet
        if (!peerConnection) {

            console.log(
                "PeerConnection not created yet."
            );

            console.log(
                "Queueing ICE candidate."
            );

            pendingCandidates.push(
                message.candidate
            );

            console.log(
                "Pending candidates:",
                pendingCandidates.length
            );

            return;
        }


        // PeerConnection is closed
        if (
            peerConnection.signalingState === "closed"
        ) {

            console.log(
                "Ignoring ICE candidate because PeerConnection is closed"
            );

            return;
        }


        // Remote SDP has not arrived yet
        if (!peerConnection.remoteDescription) {

            console.log(
                "Remote description not set yet."
            );

            console.log(
                "Queueing ICE candidate."
            );

            pendingCandidates.push(
                message.candidate
            );

            console.log(
                "Pending candidates:",
                pendingCandidates.length
            );

            return;
        }


        // Remote SDP exists
        await peerConnection.addIceCandidate(
            message.candidate
        );

        console.log(
            "ICE Candidate added"
        );
    }


    // ----------------------------
    // Customer receives Offer
    // ----------------------------
    if (message.type === "offer") {

        console.log("Received SDP Offer");

        callId = message.call_id;

        console.log(
            "CALL ID received:",
            callId
        );

        setCallState("connecting");

        peerConnection = createPeerConnection();

        await startCamera();

        const offer = {
            type: "offer",
            sdp: message.sdp
        };

        await peerConnection.setRemoteDescription(offer);

        console.log(
            "Remote SDP Offer set"
        );

        await addPendingCandidates();

        const answer =
            await peerConnection.createAnswer();

        console.log(
            "SDP Answer created"
        );

        await peerConnection.setLocalDescription(
            answer
        );

        console.log(
            "Local SDP Answer set"
        );

        socket.send(JSON.stringify({
            type: "answer",
            call_id: callId,
            sdp: answer.sdp
        }));

        console.log(
            "SDP Answer sent"
        );
    }


    // ----------------------------
    // Agent receives Answer
    // ----------------------------
    if (message.type === "answer") {

        console.log("Received SDP Answer");

        if (message.call_id !== callId) {
            console.log(
                "Ignoring Answer for different call:",
                message.call_id
            );
            return;
        }

        const answer = {
            type: "answer",
            sdp: message.sdp
        };

        await peerConnection.setRemoteDescription(answer);

        console.log("Remote SDP Answer set");

        // Now it is safe to add queued ICE candidates
        await addPendingCandidates();
    }
};


// --------------------------------
// WebSocket events
// --------------------------------

socket.onclose = () => {
    console.log("Disconnected from signaling server");
};
socket.onerror = (error) => {
    console.error("WebSocket error:", error);
};


// --------------------------------
// Call Controls
// --------------------------------

const startCallButton =
    document.getElementById("startCall");

const endCallButton =
    document.getElementById("endCall");


// --------------------------------
// Accept Call (Customer)
// --------------------------------
document.getElementById("acceptCall").onclick = () => {

    console.log("CALL ACCEPTED");

    if (!callId) {
        console.log("No call ID available");
        return;
    }

    document.getElementById(
        "incomingCall"
    ).style.display = "none";

    setCallState("connecting");


    // Customer joins this call
    socket.send(JSON.stringify({
        type: "join",
        call_id: callId,
        role: role
    }));

    console.log(
        "Customer joined call:",
        callId
    );


    // Tell Agent that Customer accepted
    socket.send(JSON.stringify({
        type: "accept_call",
        call_id: callId
    }));

    console.log(
        "Accept sent for call:",
        callId
    );
};


// --------------------------------
// Reject Call (Customer)
// --------------------------------
document.getElementById("rejectCall").onclick = () => {
    console.log("CALL REJECTED");

    if (!callId) {
        console.log("No call ID available");
        return;
    }

    // Tell Agent that Customer rejected the call
    socket.send(JSON.stringify({
        type: "reject_call",
        call_id: callId
    }));

    console.log(
        "Reject sent for call:",
        callId
    );

    // Hide incoming call box
    document.getElementById(
        "incomingCall"
    ).style.display = "none";

    // Reset local call state
    setCallState("idle");

    callId = null;

    console.log("Customer returned to idle state");
};


document.getElementById("copyLink").onclick = async () => {
    const customerLink = document.getElementById("customerLink");
    await navigator.clipboard.writeText(customerLink.value);
    console.log("Customer link copied");
    alert("Customer link copied!");
};


// --------------------------------
// Start Call
// --------------------------------
startCallButton.onclick = async () => {
    console.log("START CALL clicked");
    if (callState !== "idle") {
        console.log(
            "Cannot start call. Current state:",
            callState
        );
        return;
    }
    setCallState("calling");
    callId = generateCallId();
    console.log("CALL ID:", callId);

    // Generate unique Customer KYC URL
    const customerUrl =
        `${window.location.origin}/index.html?role=customer&call_id=${callId}`;

    console.log("CUSTOMER URL:", customerUrl);

    alert(
        "Customer KYC Call Link:\n\n" +
        customerUrl
    );

    const customerLinkBox = document.getElementById("customerLinkBox");
    const customerLink    = document.getElementById("customerLink");
    customerLink.value            = customerUrl;
    customerLinkBox.style.display = "block";

    // Prepare WebRTC PeerConnection
    peerConnection = createPeerConnection();
    pendingCandidates = [];

    // Tell signaling server to create the call
    socket.send(JSON.stringify({
        type: "call_invitation",
        call_id: callId
    }));

    console.log("Call created on signaling server");
};


// --------------------------------
// End Call
// --------------------------------
endCallButton.onclick = () => {
    console.log("END CALL clicked");
    // Tell the other participant
    socket.send(JSON.stringify({
        type: "hangup",
        call_id: callId
    }));

    // End our own call
    endCall();

};


// --------------------------------
// End Call Locally
// --------------------------------
function endCall() {
    console.log("Ending call locally");

    setCallState("ended");

    // Stop camera and microphone
    if (localStream) {
        localStream.getTracks().forEach((track) => {
            track.stop();
        });
        localStream = null;
    }

    // Close WebRTC connection
    if (peerConnection) {
        peerConnection.close();
    }

    document.getElementById("localVideo").srcObject  = null;
    document.getElementById("remoteVideo").srcObject = null;
    hideVideoPlaceholder("localVideo",  "localPlaceholder");
    hideVideoPlaceholder("remoteVideo", "remotePlaceholder");
    console.log("Call ended");

    setCallState("idle");

    callId = null;
}