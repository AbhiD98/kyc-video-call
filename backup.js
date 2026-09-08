const socket = new WebSocket("ws://localhost:8765");
const role = new URLSearchParams(window.location.search).get("role");
document.getElementById("role").textContent = `Role: ${role}`;


// --------------------------------
// WebRTC Peer Connection
// --------------------------------

const peerConnection = new RTCPeerConnection({
    iceServers: [{urls: "stun:stun.l.google.com:19302"}]}
);

peerConnection.oniceconnectionstatechange = () => {
    console.log(
        "ICE Connection State:",
        peerConnection.iceConnectionState
    );
};

peerConnection.ontrack = (event) => {
    console.log("REMOTE TRACK RECEIVED:", event);
    const remoteVideo = document.getElementById("remoteVideo");
    remoteVideo.srcObject = event.streams[0];
    console.log("Remote stream attached to video element");
};

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
    console.log("Local camera attached to video element");

    // Add local media tracks to WebRTC connection
    localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
        console.log("Track added to PeerConnection:", track.kind);

});
}

// ############################ Till Here Unlearned ########################3




// --------------------------------
// ICE Gathering State
// --------------------------------
peerConnection.onicegatheringstatechange = () => {
    console.log(
        "ICE Gathering State:",
        peerConnection.iceGatheringState
    );
};


// --------------------------------
// ICE Candidate
// --------------------------------
peerConnection.onicecandidate = (event) => {

    console.log("ICE EVENT:", event);

    if (event.candidate) {

        console.log(
            "ICE CANDIDATE:",
            event.candidate.candidate
        );

        socket.send(JSON.stringify({
            type: "candidate",
            candidate: event.candidate
        }));

    } else {

        console.log("ICE GATHERING COMPLETE");

    }
};


// --------------------------------
// WebSocket connected
// --------------------------------
socket.onopen = async () => {
    console.log("Connected to signaling server");
    // // First initialize camera and microphone
    // await startCamera();
    // // Only Agent creates the initial Offer
    // if (role === "agent") {
    //     await createOffer();
    // }
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
    if (message.type === "candidate") {

    console.log("Received ICE Candidate");

    await peerConnection.addIceCandidate(
        message.candidate
    );

    console.log("ICE Candidate added");

}


    // ----------------------------
    // Customer receives Offer
    // ----------------------------
    if (message.type === "offer" && role === "customer") {
        console.log("Customer received SDP Offer");
        const offer = {
            type: "offer",
            sdp: message.sdp
        };
        await peerConnection.setRemoteDescription(offer);
        console.log("Remote SDP Offer set");

        // Create Answer
        const answer = await peerConnection.createAnswer();
        console.log("SDP Answer created");
        // Set our Answer as local description
        await peerConnection.setLocalDescription(answer);
        console.log("Local SDP Answer set");
        // Send Answer back to Agent
        socket.send(JSON.stringify({
            type: "answer",
            sdp: answer.sdp
        }));
        console.log("SDP Answer sent");
    }


    // ----------------------------
    // Agent receives Answer
    // ----------------------------
    if (message.type === "answer" && role === "agent") {
        console.log("Agent received SDP Answer");
        const answer = {
            type: "answer",
            sdp: message.sdp
        };
        await peerConnection.setRemoteDescription(answer);
        console.log("Remote SDP Answer set");
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
const startCallButton = document.getElementById("startCall");
const endCallButton = document.getElementById("endCall");

// Start Call
startCallButton.onclick = async () => {
    console.log("START CALL clicked");
    await startCamera();
    if (role === "agent") {
        await createOffer();
    }
};

// End Call
endCallButton.onclick = () => {
    console.log("END CALL clicked");
    // Stop camera and microphone
    if (localStream) {
        localStream.getTracks().forEach((track) => {
            track.stop();
        });
    }
    // Close WebRTC connection
    peerConnection.close();

    // Clear videos
    document.getElementById("localVideo").srcObject = null;
    document.getElementById("remoteVideo").srcObject = null;
    console.log("Call ended");
};
