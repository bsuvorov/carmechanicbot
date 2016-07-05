'use strict';

// http://goo.gl/forms/Gi2vQHlVUfgK7C6k2

/*
 * How to use webhooks:
 * While developing bots, you may need to create a webhook to provide to some APIs. You can do it with the register method:
 *
 * this.register("http_method", "/customurl", "eventName", (req, res, content) => {
 *   // Handle result here
 *   if (content.message) {
 *     this.utils.log(`New message arrived: ${content.message}`)
 *   }
 * });
 *
 * This will creates an endpoint at https://botpad.ai/webhook/[userid]/[provider][botid]/customurl for the HTTP method provided at the first parameter
 */

const Bot = require('base_bot');
const pageInfos = require('./customerinfo');
const fbMessagingService = require('./fbmessaging.js');
const carStatusMessage = require('./carstatusmessage.js')

//require the Twilio module and create a REST client
// Twilio Credentials
var accountSid = 'AC7ff9fa3ed7b9477f96f5a113ff8bb18c';
var authToken = '92910305d42bd12e61cb987defcc4fbd';
var twilioClient = require('../../runner/node_modules/twilio')(accountSid, authToken);

var log;
var request;
var mongoose;

var ignoreList = new Set();

var twilioPhoneToPageID = {
  "+16509008415": "1622837224700712"
};


var UserModel;

function lazyInitDB() {
  if (UserModel) {
    return;
  }
  var userSchema = mongoose.Schema({
    phone:{type: String, unique: true},
    psid: {type: String, unique: true},
    pageID:{type: String},
    info: {
      firstName: String,
      lastName: String,
      profilePic: String,
      locale: String,
      timeZone: Number,
      gender: String
    },
    cars: [{yearMakeModel: String, lastServiceMileage: Number, lastService: Date}],
    shopname: {type: String, unique: true}
  });

  UserModel = mongoose.model('User', userSchema);
}

function sendGetStartedForPageIDSenderID(pageID, senderID) {
  let page = pageInfos[pageID];
  let getStartedMessage = templateWithImageURLTitleSubtitleAndButtons(
    page.getStartedImage, "Welcome to " + page.name + ". Have you serviced your car with us before?", null, greetingPostbackButtons);

  fbMessagingService.postMessageDataToPageSenderID(senderID, page.token, getStartedMessage);
}


function setGetStartedPostback(pageID, token) {
  let callToActions = [{payload: JSON.stringify({action: postbackGetStarted})}];
  fbMessagingService.setCallToActions(pageID, token, "new_thread", callToActions);
}

function setNullStateMenu(pageID, token) {
  let callToActions = [
    {type: "postback",
    payload: JSON.stringify({action: postbackNullMenuServiceAppointment}),
    title: "Schedule Service Appointment"},

    {type: "postback",
    payload: JSON.stringify({action: postbackNullMenuServiceHistory}),
    title: "Service History"},

    {type: "postback",
    payload: JSON.stringify({action: postbackNullMenuRequestQuote}),
    title: "Request a Quote"},

    {type: "postback",
    payload: JSON.stringify({action: postbackNullMenuSpecials}),
    title: "Specials"},

    {type: "postback",
    payload: JSON.stringify({action: postbackNullMenuContactInfo}),
    title: "Contact Info"}
  ];
  fbMessagingService.setCallToActions(pageID, token, "existing_thread", callToActions);
}

function setupPageOnInit() {
  for (var pageID in pageInfos) {
    if (pageInfos.hasOwnProperty(pageID)) {
      let token = pageInfos[pageID].token;
      let description = pageInfos[pageID].description;
      fbMessagingService.setWelcomeMessage(pageID, token, description);
      setGetStartedPostback(pageID, token);
      setNullStateMenu(pageID, token);
    }
  }
}

function fechUserModelForPhoneNumber(phoneNumber, pageID, completion) {
  return UserModel.findOne({phone: phoneNumber, pageID: pageID}, function(err, targetUser){
    if (!targetUser) {
      log("Failed to find "+ phoneNumber);
    } else {
      log("Found "+ phoneNumber + " with psid=" + targetUser.psid);
    }

    if (completion) {
      completion(targetUser);
    }
  });
}

// top level business logic functions
function sendCarStatusMessageToPhoneNumber(carStatusMessage, pageID, phoneNumber) {
  if (this.ignoreList.has(phoneNumber)) {
    log("Phonenumber is in ignore list: ", phoneNumber);
    return;
  }

  let fbMessage = carStatusMessage.fbFormat(phoneNumber);
  log("Sending FB message to phone=", phoneNumber);

  postMessageDataToPhoneNumber(phoneNumber, pageID, fbMessage, function(error){
    log ("calling completion of postMessageDataToPhoneNumber");
    if (error) {
      log("Encountered error when sending message to ", phoneNumber);
      let smsMessage = carStatusMessage.smsFormat;
      log("Sending sms:",smsMessage);
      sendSMSMessageToPhoneNumber(smsMessage, phoneNumber);
    }
  });
}

function sendSMSMessageToPhoneNumber(smsMessage, phoneNumber, completion) {
  twilioClient.messages.create({
    to: phoneNumber,
    from: "+16509008415",
    body: smsMessage
  }, function(err, message) {
    if (err) {
      log("Encountered error when sending SMS:", err);
      if (completion) {
        completion(err);
      }
    } else {
      log("Message sent without problems", message.sid);
      if (completion) {
        completion(null);
      }
    }
  });
}


const postbackNullMenuServiceAppointment = "postbackNullMenuServiceAppointment";
const postbackNullMenuServiceHistory = "postbackNullMenuServiceHistory";
const postbackNullMenuRequestQuote = "postbackNullMenuRequestQuote";
const postbackNullMenuSpecials = "postbackNullMenuSpecials";
const postbackNullMenuContactInfo = "postbackNullMenuContactInfo";

const postbackWillPickUpToday = "postbackWillPickUpToday";
const postbackDenyPickupToday = "postbackDenyPickupToday";
const postbackConfirmReceivingMessage = "postbackConfirmReceivingMessage";
const postbackDenyReceivingMessage = "postbackDenyReceivingMessage";
const postbackApproveRepairs = "postbackApproveRepairs";
const postbackRejectRepairs = "postbackRejectRepairs";
const postbackGetStarted="getStarted";
const postbackServicedBeforeYes="servicedBeforeYes";
const postbackServicedBeforeNo="servicedBeforeNo";
const greetingPostbackButtons = [
  fbMessagingService.postbackPayload("Yes", JSON.stringify({action: postbackServicedBeforeYes})),
  fbMessagingService.postbackPayload("No", JSON.stringify({action: postbackServicedBeforeNo}))];

function handlePostbackCommand(pageID, senderID, fullPostback) {
  let postback = fullPostback.split("_")[0];
  let pageToken = pageInfos[pageID].token;
  if (postback == postbackGetStarted) {
    return sendGetStartedForPageIDSenderID(pageID, senderID);
  } else if (postback == postbackWillPickUpToday) {
    return fbMessagingService.sendFacebookTextMessage(senderID, pageToken, `Thanks for confirmation!`);
  } else if (postback == postbackDenyPickupToday) {
    return fbMessagingService.sendFacebookTextMessage(senderID, pageToken, `Thanks for letting us know! We will wait for you the next business day.`);
  } else if (postback == postbackConfirmReceivingMessage) {
    let phoneNumber = fullPostback.split("_")[1];
    log("unblocking " + phoneNumber);
    ignoreList.delete(phoneNumber);
    ignoreList.delete(senderID);
    return fbMessagingService.sendFacebookTextMessage(senderID, pageToken, `Thanks for confirmation!`);
  } else if (postback == postbackDenyReceivingMessage) {
    let phoneNumber = fullPostback.split("_")[1];
    log("blocking " + phoneNumber);
    ignoreList.add(phoneNumber);
    ignoreList.add(senderID);
    log("User requested to avoid messaging them, id=", senderID);
    return fbMessagingService.sendFacebookTextMessage(senderID, pageToken, `Thanks. We won't send you any facebook or text messages anymore.`);
  } else if (postback == postbackApproveRepairs) {
    return fbMessagingService.sendFacebookTextMessage(senderID, pageToken, `Thanks for confirmation!`);
  } else if (postback == postbackRejectRepairs) {
    return fbMessagingService.sendFacebookTextMessage(senderID, pageToken, `Thanks, we will call you shortly.`);
  } else {
    log("Unknown request ", postback);
  }
}

function handlePostbacks(pageID, senderID, postbackMessage) {
  var response = JSON.stringify(postbackMessage);
  log("Postback not handled yet. Received ", response);
  response = JSON.parse(JSON.parse(response).payload);
  log("parsed response ", response);

  handlePostbackCommand(pageID, senderID, response.action);
}

function isNumeric(num){
  return !isNaN(num);
}

function handleIncomingMessageFromAdmin(adminID, pageID, text) {
  let phoneNumber = text.substring(0,10);
  if (isNumeric(phoneNumber)) {
    if (ignoreList.has("+1" + phoneNumber)) {
      fbMessagingService.sendFacebookTextMessage(adminID, pageToken, phoneNumber + " added themselves to ignore list. Please call this customer.");
    } else {
      let message = text.substring(10, text.length).trim();
      if (message.length > 0) {
        log(`Sending to ${phoneNumber} text: ${message}`);
        sendSMSMessageToPhoneNumber(message, phoneNumber, function(error) {
          if (error) {
            fbMessagingService.sendFacebookTextMessage(adminID, pageToken, error.message);
          } else {
            fbMessagingService.sendFacebookTextMessage(adminID, pageToken, "Delivered message to " + phoneNumber);
          }
        });
      } else {
        fbMessagingService.sendFacebookTextMessage(adminID, pageToken, "Message doesn't have correct body");
      }
    }
  } else {
    fbMessagingService.sendFacebookTextMessage(adminID, pageToken, "Message doesn't appear to have correct phone number:" + phoneNumber);
  }
}

function handleMessage(senderID, pageID, text) {
  let pageToken = pageInfos[pageID].token;
  for (let item of pageInfos[pageID].adminIDs) log(item);
  if (pageInfos[pageID].adminIDs.has(senderID)) {
    handleIncomingMessageFromAdmin(senderID, pageID, text);
  } else {
    log(`Unhandled message from ${senderID} with ${text}`);
  }
}

class MyBot extends Bot {
  constructor(utils, info) {
    super(utils, info);

    // Event emitted on init
    this.on("init", () => {
      this.utils.log("initialized");
      console.log("console log");

      log = this.utils.log;
      request = this.utils.request;
      mongoose = this.utils.mongoose;

      fbMessagingService.request = request;
      fbMessagingService.log = log;

      setupPageOnInit();
    });
    // Event emitted on facebook event received
    this.on("messengerEvent", (event) => {
      var senderID = event.sender.id;
      var pageID = event.recipient.id;
      log("Event:", event);
      if ("message" in event) {
        log("Message" + JSON.stringify(event.message));
        if ("text" in event.message) {
          return handleMessage(senderID, pageID, textFromMessage(event.message));
        } else  if ("attachments" in event.message) {
          log("Unhandled attachments:", event.message);
          // return sendAttachmentMessage(userData[senderID].chatsWithPSID, event.message.attachments[0]);
        }
      } else if ("postback" in event) {
        log("Received postback event", event);
        return handlePostbacks(pageID, senderID, event.postback);
      } else if (("read" in event) || ("delivery" in event) ){
        // just ignore
        // return log("Message Read by Client");
      } else {
        var raw_event = JSON.stringify(event);
        return log("****Unhandled event=" + raw_event);
      }
    });

    this.registerWebhook("GET", "/lookup", (req, res, content) => {
      let dict = {
        phone: "4089126890",
        fullname: "Boris Suvorov",
        car: {
          makeAndModel: "2011 Nissan Juke",
          mileage: "75075",
          description: "LOF, checked brakes"
        }
      };

      return res.status(200).send(JSON.stringify(dict));
    });

    this.registerWebhook("post", "/admin", (req, res, content) => {
      var log = this.utils.log;
      log("New message arrived: " + JSON.stringify(content));
      let dict = JSON.parse(JSON.stringify(content));
      log(dict.type);
      let message = new carStatusMessage(dict);
      let targetPhoneNumber = "+1" + dict["phone"];
      if (!ignoreList.has(targetPhoneNumber)) {
        log("Sending message to ", dict.pageID);
        sendCarStatusMessageToPhoneNumber(message, dict.pageID, targetPhoneNumber);
      } else {
        log("Phone number is in ignore list:", targetPhoneNumber);
      }
      return res.sendStatus(200);
    });

    this.registerWebhook("post", "/twilio", (req, res, content) => {
      this.utils.log("New message arrived: " + JSON.stringify(content));
      // "ToCountry":"US","ToState":"CA","SmsMessageSid":"SMa50ad781944f7925fe53a15c0fbe1232",
      // "NumMedia":"0","ToCity":"SAN JOSE","FromZip":"94108","SmsSid":"SMa50ad781944f7925fe53a15c0fbe1232",
      // "FromState":"CA","SmsStatus":"received","FromCity":"SAN FRANCISCO","Body":"Great",
      // "FromCountry":"US","To":"+16509008415","ToZip":"95112","NumSegments":"1",
      // "MessageSid":"SMa50ad781944f7925fe53a15c0fbe1232","AccountSid":"AC7ff9fa3ed7b9477f96f5a113ff8bb18c",
      // "From":"+14089126890","ApiVersion":"2010-04-01"}

      let smsMessageDict = JSON.parse(JSON.stringify(content));
      let trimmedPhoneNumber = smsMessageDict.From.replace("+1", "");
      let messageForAdmin = ["From:", trimmedPhoneNumber,"\nText:", smsMessageDict.Body].join(" ");
      let pageID = twilioPhoneToPageID[smsMessageDict.To];
      let pageToken = pageInfos[pageID].token;
      let adminID = pageInfos[pageID].adminID;
      fbMessagingService.sendFacebookTextMessage(adminID, pageToken, messageForAdmin);
      return res.status(200);
    });
  }
}

// utility functions
function textFromMessage(message) {
  return message.text.substring(0, 320).trim();
}

module.exports = MyBot;
