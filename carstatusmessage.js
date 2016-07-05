'use strict';

const mCarIsReadyType = "Car is ready";
const mCarDropOffType = "Confirm car dropoff";
const mCarRepairsApprovalType = "Request car repair or parts approval";


class carStatusUpdateMessage {
  constructor(message) {
    this.message = message;
  }

  get smsFormat() {
    if (!this.message) {
      return null;
    }

    var greeting = "Hi!";
    var typeSpecificMessage;

    if (this.message.fullname) {
      greeting = "Hi " + this.message.fullname + "!";
    }

    if (this.message.type === mCarIsReadyType) {
      typeSpecificMessage = "Your car is ready for pickup. As a reminder, we close at 6 pm. Please message us back if you can't pick it up today.";
    } else if (this.message.type === mCarDropOffType) {
      typeSpecificMessage = "Thank you for dropping off your car with us today. We will text you when your car is ready for pickup.";
    } else if (this.message.type === mCarRepairsApprovalType) {
      typeSpecificMessage = [this.message.desc, ". Parts $", this.message.parts, ", labor $", this.message.labor, "."].join();
    } else {
      console.log("Uknown message type: ", this.message.type);
      return null;
    }

    return [greeting, typeSpecificMessage].join(" ");
  }

  fbFormat(phoneNumber) {
    if (!this.message) {
      return null;
    }

    var greeting = "Hi!";
    var typeSpecificMessage;
    var buttons;

    if (this.message.fullname) {
      greeting = "Hi " + this.message.fullname + "!";
    }

    if (this.message.type === mCarIsReadyType) {
      typeSpecificMessage = "Your car is ready for pickup. As a reminder, we close at 6 pm. Let us know if you can't stop by today to pick it up.";
      let confirmPickupToday = fbMessagingService.postbackPayload("I'll stop by today", JSON.stringify({action: postbackWillPickUpToday}));
      let denyPickupToday = fbMessagingService.postbackPayload("Can't stop by today", JSON.stringify({action: postbackDenyPickupToday}));
      buttons = [confirmPickupToday, denyPickupToday];
    } else if (this.message.type === mCarDropOffType) {
      typeSpecificMessage = "Thank you for dropping off your car with us today. Do you want to receive message from us when your car is ready?";
      let confirmRecevingMessage = fbMessagingService.postbackPayload("Sure!", JSON.stringify({action: postbackConfirmReceivingMessage + "_" + phoneNumber}));
      let denyReceivingMessage = fbMessagingService.postbackPayload("No, thank you", JSON.stringify({action: postbackDenyReceivingMessage + "_" + phoneNumber}));
      buttons = [confirmRecevingMessage, denyReceivingMessage];
    } else if (this.message.type === mCarRepairsApprovalType) {
      typeSpecificMessage = [this.message.desc, ". Parts $", this.message.parts, ", labor $", this.message.labor, "."].join("");
      let approveRepairs = fbMessagingService.postbackPayload("Approved!", JSON.stringify({action: postbackApproveRepairs}));
      let rejectRepairs = fbMessagingService.postbackPayload("No, please call me", JSON.stringify({action: postbackRejectRepairs}));
      buttons = [approveRepairs, rejectRepairs];
    } else {
      log("Uknown message type: ", this.message.type);
      return null;
    }

    let message = [greeting, typeSpecificMessage].join(" ");
    return fbMessagingService.formMessageDataWithTextAndButtons(message, buttons);
  }
}

module.exports = carStatusUpdateMessage;
