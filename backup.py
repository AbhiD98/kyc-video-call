
import asyncio
import json
import websockets


calls = {}


def cleanup_call(call_id):
    if call_id in calls:
        del calls[call_id]
        print(f"Call cleaned up: {call_id}")


async def handle_client(websocket):

    print("Client connected")

    call_id = None
    role = None

    try:

        async for raw_message in websocket:

            message = json.loads(raw_message)

            message_type = message.get("type")

            message_call_id = message.get("call_id")

            print(
                f"Received: {message_type}"
            )


            # --------------------------------
            # REGISTER CLIENT
            # --------------------------------

            if message_type == "register":

                role = message.get("role")

                print(
                    f"Client registered as: {role}"
                )

                continue


            # --------------------------------
            # CUSTOMER OPENS CALL LINK
            # --------------------------------

            if message_type == "call_link_opened":
                call_id = message_call_id

                print(
                    f"Customer opened call link: {call_id}"
                )

                call = calls.get(call_id)

                # Call does not exist
                if not call:
                    print(
                        f"Call link rejected. Call does not exist: {call_id}"
                    )

                    await websocket.send(
                        json.dumps({
                            "type": "error",
                            "error": "call_not_found",
                            "call_id": call_id
                        })
                    )

                    continue

                # Customer already joined
                if "customer" in call:
                    print(
                        f"Call link rejected. Customer already joined: {call_id}"
                    )

                    await websocket.send(
                        json.dumps({
                            "type": "error",
                            "error": "customer_already_joined",
                            "call_id": call_id
                        })
                    )

                    continue

                # Store customer temporarily
                call["pending_customer"] = websocket

                print(
                    f"Customer waiting for call: {call_id}"
                )

                # Tell this customer that the call exists
                await websocket.send(
                    json.dumps({
                        "type": "call_invitation",
                        "call_id": call_id
                    })
                )

                continue


            # --------------------------------
            # JOIN CALL
            # --------------------------------

            if message_type == "join":

                requested_role = message.get("role")

                print(
                    f"{requested_role} joining call: {message_call_id}"
                )

                # Call must already exist
                if message_call_id not in calls:

                    print(
                        f"Join rejected. Call does not exist: {message_call_id}"
                    )

                    await websocket.send(
                        json.dumps({
                            "type": "error",
                            "error": "call_not_found",
                            "call_id": message_call_id
                        })
                    )

                    continue

                # Only Agent and Customer are valid roles
                if requested_role not in ("agent", "customer"):

                    print(
                        f"Join rejected. Invalid role: {requested_role}"
                    )

                    await websocket.send(
                        json.dumps({
                            "type": "error",
                            "error": "invalid_role",
                            "call_id": message_call_id
                        })
                    )

                    continue

                call = calls[message_call_id]

                # Only one participant of each role
                if requested_role in call:

                    print(
                        f"Join rejected. {requested_role} already joined."
                    )

                    await websocket.send(
                        json.dumps({
                            "type": "error",
                            "error": "role_already_joined",
                            "call_id": message_call_id
                        })
                    )

                    continue

                # Add participant
                call_id = message_call_id
                role = requested_role
                call[role] = websocket

                # Customer has now moved from pending → active
                if requested_role == "customer":
                    call.pop("pending_customer", None)

                print(
                    "Current call participants:",
                    list(call.keys())
                )

                continue


            # --------------------------------
            # CALL INVITATION
            # --------------------------------

            if message_type == "call_invitation":

                call_id = message_call_id

                print(
                    f"Creating call: {call_id}"
                )

                # Prevent duplicate call IDs
                if call_id in calls:

                    print(
                        f"Call already exists: {call_id}"
                    )

                    await websocket.send(
                        json.dumps({
                            "type": "error",
                            "error": "call_already_exists",
                            "call_id": call_id
                        })
                    )

                    continue

                # Create the call with the Agent already inside it
                calls[call_id] = {
                    "agent": websocket
                }

                role = "agent"

                print(
                    f"Call created: {call_id}"
                )

                continue


            # --------------------------------
            # ACCEPT CALL
            # --------------------------------

            if message_type == "accept_call":

                call_id = message_call_id

                call = calls.get(call_id)

                if not call:

                    print(
                        "Call not found:",
                        call_id
                    )

                    continue


                agent = call.get("agent")

                if agent:

                    await agent.send(
                        json.dumps(message)
                    )

                    print(
                        "Accept sent to Agent"
                    )

                continue


            # --------------------------------
            # REJECT CALL
            # --------------------------------

            if message_type == "reject_call":

                call_id = message_call_id

                call = calls.get(call_id)

                if not call:

                    print(
                        "Call not found:",
                        call_id
                    )

                    continue


                agent = call.get("agent")

                if agent:

                    await agent.send(
                        json.dumps(message)
                    )

                    print(
                        "Reject sent to Agent"
                    )

                cleanup_call(call_id)

                continue


            # --------------------------------
            # HANGUP CALL
            # --------------------------------

            if message_type == "hangup":

                call_id = message_call_id

                call = calls.get(call_id)

                if not call:

                    print(
                        "Call not found:",
                        call_id
                    )

                    continue


                for participant_role, client in call.items():

                    if client != websocket:

                        await client.send(
                            json.dumps(message)
                        )

                print("Hangup sent to other participant")

                cleanup_call(call_id)

                continue


            # --------------------------------
            # OTHER SIGNALING
            # OFFER / ANSWER / CANDIDATE
            # --------------------------------

            if not call_id:

                print(
                    "Client has not joined a call"
                )

                continue


            call = calls.get(call_id)

            if not call:

                print(
                    "Call does not exist:",
                    call_id
                )

                continue


            for participant_role, client in call.items():

                if client != websocket:

                    await client.send(
                        json.dumps(message)
                    )


    except websockets.exceptions.ConnectionClosed:

        print("Client disconnected")


    finally:

        # Check whether this client was part of a call
        if call_id and call_id in calls:
            call = calls[call_id]

            # Customer opened the link but had not joined yet
            if call.get("pending_customer") == websocket:
                print(
                    f"Pending customer disconnected from call: {call_id}"
                )

                del call["pending_customer"]

                # Keep the Agent's call alive
                print(
                    f"Call remains active for Agent: {call_id}"
                )

            # Active participant disconnected
            elif role in call and call[role] == websocket:

                print(
                    f"Active participant disconnected: {role}, {call_id}"
                )

                # Notify the other participant
                for participant_role, client in call.items():

                    if participant_role != role:

                        try:
                            await client.send(
                                json.dumps({
                                    "type": "hangup",
                                    "call_id": call_id
                                })
                            )

                        except websockets.exceptions.ConnectionClosed:
                            print(
                                f"{participant_role} is already disconnected"
                            )

                # Remove disconnected participant
                del call[role]

                # End the call
                cleanup_call(call_id)

        print(
            f"Removed {role} from call {call_id}"
        )


async def main():

    async with websockets.serve(
        handle_client,
        "localhost",
        8765
    ):

        print(
            "Signaling server running on "
            "ws://localhost:8765"
        )

        await asyncio.Future()


asyncio.run(main())