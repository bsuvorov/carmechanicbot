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

var Bot = require('base_bot');
var pageInfos = require('./customerinfo');
var fbMessagingService = require('./fbmessaging.js');
var CarStatusMessage = require('./carstatusmessage.js');
var PNF = require('google-libphonenumber').PhoneNumberFormat;
var phoneUtil = require('google-libphonenumber').PhoneNumberUtil.getInstance();

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
  "+16509008415": "1622837224700712",
  "+16509665743": "475909289137929"
};

var chatFlowByPageID = {
  "475909289137929": {},
  "1622837224700712": {},
};


var UserModel;

const eraseCommand = "erase_erase";
function eraseDB() {
  UserModel.remove({}, function() {
    log("removed UserDB");
  });
}

function lazyInitDB() {
  if (UserModel) {
    return;
  }
  var userSchema = mongoose.Schema({
    phone:{type: Number, index: true, unique: true, sparse: true},
    psid: {type: String, trim: true, index: true, unique: true, sparse: true},
    pageID:{type: String},
    info: {
      firstName: String,
      lastName: String,
      profilePic: String,
      locale: String,
      timeZone: Number,
      gender: String,
    },
    cars: [{yearMakeModel: String, lastServiceMileage: Number, lastService: Date}],
  });

  UserModel = mongoose.model('User', userSchema);
}

function saveFBUserInfoToDB(psid, pageID, callback) {
  request({
    url: 'https://graph.facebook.com/v2.6/'+psid+'?fields=first_name,last_name,profile_pic,locale,timezone,gender',
    qs: { access_token: pageInfos[pageID].token },
    method: 'GET'
  }, function (error, response) {
    if (error) {
      log('Error sending message: ', error);
      if (callback) {
        callback(error, null);
      }
    } else if (response.body.error) {
      log('Error: ', response.body.error);
      if (callback) {
        callback(response.body.error, null);
      }
    } else {
      var data = JSON.parse(response.body);
      log('Info fetched: ', data);
      log('psid = ', psid);
      var newUserEntry = new UserModel({
        psid: psid,
        pageID: pageID,
        info: {
          firstName: data.first_name,
          lastName: data.last_name,
          profilePic: data.profile_pic,
          locale: data.locale,
          timeZone: data.time_zone,
          gender: data.gender,
        }
      });

      newUserEntry.save(function (err) {
        if (err) {
          log(`Error while saving user with psid =${psid}, pageID=${pageID} error=${err}`);
          if (callback) {
            callback(err, null);
          }
        } else {
          log("User saved");
          if (callback) {
            callback(null, newUserEntry);
          }
        }
      });
    }
  });
}

function saveTargetUser(targetUser, phoneNumber) {
  targetUser.phone = phoneNumber;
  targetUser.save(function (err) {
    if (err) {
      log(`Error while saving user phone number ${phoneNumber}, error=${err}`);
    } else {
      log(`Saved user phone number ${phoneNumber}`);
    }
  });
}

function savePhoneNumberToUserWith(psid, pageID, phoneNumber) {
  fetchUserModelByPSID(psid, pageID, function(targetUser) {
    if (targetUser) {
      saveTargetUser(targetUser, phoneNumber);
    } else {
      saveFBUserInfoToDB(psid, pageID, function(error, targetUser) {
        if (targetUser) {
          saveTargetUser(targetUser, phoneNumber);
        }
      })
    }
  });
}

function sendGetStartedForPageIDSenderID(pageID, senderID) {
  let page = pageInfos[pageID];
  let getStartedMessage = fbMessagingService.templateWithImageURLTitleSubtitleAndButtons(
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
    payload: JSON.stringify({action: postbackNullMenuResetChat}),
    title: "Go to the first menu"},

    // {type: "postback",
    // payload: JSON.stringify({action: postbackNullMenuServiceHistory}),
    // title: "Service History"},
    //
    // {type: "postback",
    // payload: JSON.stringify({action: postbackNullMenuRequestQuote}),
    // title: "Request a Quote"},
    //
    // {type: "postback",
    // payload: JSON.stringify({action: postbackNullMenuSpecials}),
    // title: "Specials"},
    //
    // {type: "postback",
    // payload: JSON.stringify({action: postbackNullMenuContactInfo}),
    // title: "Contact Info"}
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

function fetchUserModelByPSID(psid, pageID, completion) {
  return UserModel.findOne({psid: psid, pageID: pageID}, function(err, targetUser){
    if (!targetUser) {
      log("Failed to find "+ psid);
    } else {
      log("Found user with psid=" + targetUser.psid);
    }

    if (completion) {
      completion(targetUser);
    }
  });
}


function fetchUserModelForPhoneNumber(phoneNumber, pageID, completion) {
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
  if (ignoreList.has(phoneNumber)) {
    log("Phonenumber is in ignore list: ", phoneNumber);
    return;
  }

  let fbMessage = carStatusMessage.fbFormat(phoneNumber);

  fetchUserModelForPhoneNumber(phoneNumber.slice(2), pageID, function(targetUser) {
    let pageToken = pageInfos[pageID].token;
    if (targetUser) {
      log("Sending FB message to psid=", targetUser.psid);
      fbMessagingService.postMessageDataToPageSenderID(targetUser.psid, pageToken, fbMessage, function(error) {
        log ("calling completion of postMessageDataToPageSenderID");
        if (error) {
          log("Encountered error when sending message to ", phoneNumber);
          let smsMessage = carStatusMessage.smsFormat;
          let fromPhoneNumber = pageInfos[pageID].twilioPhone;
          log("Sending sms:",smsMessage, " from phone #", fromPhoneNumber, " to phone#", phoneNumber);
          sendSMSMessageToPhoneNumber(smsMessage, phoneNumber, fromPhoneNumber);
        }
      });
    } else {
      // log("Sending FB message to phone=", phoneNumber);
      // fbMessagingService.postMessageDataToPhoneNumber(phoneNumber, pageToken, fbMessage, function(error){
      //   log ("calling completion of postMessageDataToPhoneNumber");
      //   if (error) {
      //     log("Encountered error when sending message to ", phoneNumber);
          let smsMessage = carStatusMessage.smsFormat;
          let fromPhoneNumber = pageInfos[pageID].twilioPhone;
          log("Sending sms:",smsMessage, " from phone #", fromPhoneNumber, " to phone#", phoneNumber);
          sendSMSMessageToPhoneNumber(smsMessage, phoneNumber, fromPhoneNumber);
      //   }
      // });
    }
  });
}

function sendSMSMessageToPhoneNumber(smsMessage, phoneNumber, fromPhoneNumber) {
  twilioClient.messages.create({
    to: phoneNumber,
    from: fromPhoneNumber,
    body: smsMessage
  }, function(err, message) {
    if (err) {
      log("Encountered error when sending SMS:", err);
    } else {
      log("Message sent without problems", message.sid);
    }
  });
}

const postbackNullMenuResetChat = "postbackNullMenuResetChat";
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


function attemptToSendMessageTo(senderID, pageID, message) {

  if (ignoreList.has(senderID)) {
    return;
  }

  let pageToken = pageInfos[pageID].token;
  fbMessagingService.sendFacebookTextMessage(senderID, pageToken, message);
}

function handlePostbackCommand(pageID, senderID, fullPostback) {
  let postback = fullPostback.split("_")[0];
  if (postback == postbackGetStarted) {
    saveFBUserInfoToDB(senderID, pageID);
    return sendGetStartedForPageIDSenderID(pageID, senderID);
  } else if (postback == postbackServicedBeforeYes) {
    if (!chatFlowByPageID[pageID].hasOwnProperty(senderID)) {
      chatFlowByPageID[pageID][senderID] = {};
    }
    chatFlowByPageID[pageID][senderID].registeringPhone = true;
    return attemptToSendMessageTo(senderID, pageID, `Welcome back! Please get started by entering your phone number that you use with our service.`);
  } else if (postback == postbackServicedBeforeNo) {
    return attemptToSendMessageTo(senderID, pageID, `We're always happy to see new customers. How can we help you today?`);
  } else if (postback == postbackNullMenuResetChat) {
    chatFlowByPageID[pageID][senderID] = {};
    return sendGetStartedForPageIDSenderID(pageID, senderID);
  } else if (postback == postbackNullMenuServiceAppointment) {
    return attemptToSendMessageTo(senderID, pageID, `When would you like to come? We are open Monday through Friday from 8 am till 5 pm.`);
  } else if (postback == postbackWillPickUpToday) {
    return attemptToSendMessageTo(senderID, pageID, `Thanks for confirmation!`);
  } else if (postback == postbackDenyPickupToday) {
    return attemptToSendMessageTo(senderID, pageID, `Thanks for letting us know! We will wait for you the next business day.`);
  } else if (postback == postbackConfirmReceivingMessage) {
    let phoneNumber = fullPostback.split("_")[1];
    log("unblocking " + phoneNumber);
    ignoreList.delete(phoneNumber);
    ignoreList.delete(senderID);
    return attemptToSendMessageTo(senderID, pageID, `Thanks for confirmation!`);
  } else if (postback == postbackDenyReceivingMessage) {
    let phoneNumber = fullPostback.split("_")[1];
    log("blocking " + phoneNumber);
    ignoreList.add(phoneNumber);
    ignoreList.add(senderID);
    log("User requested to avoid messaging them, id=", senderID);
    return attemptToSendMessageTo(senderID, pageID, `Thanks. We won't send you any facebook or text messages anymore.`);
  } else if (postback == postbackApproveRepairs) {
    return attemptToSendMessageTo(senderID, pageID, `Thanks for confirmation!`);
  } else if (postback == postbackRejectRepairs) {
    return attemptToSendMessageTo(senderID, pageID, `Thanks, we will call you shortly.`);
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
      attemptToSendMessageTo(adminID, pageID, phoneNumber + " added themselves to ignore list. Please call this customer.");
    } else {
      let message = text.substring(10, text.length).trim();
      if (message.length > 0) {
        log(`Sending to ${phoneNumber} text: ${message}`);
        sendSMSMessageToPhoneNumber(message, phoneNumber, pageInfos[pageID].twilioPhone, function(error) {
          if (error) {
            attemptToSendMessageTo(adminID, pageID, error.message);
          } else {
            attemptToSendMessageTo(adminID, pageID, "Delivered message to " + phoneNumber);
          }
        });
      } else {
        attemptToSendMessageTo(adminID, pageID, "Message doesn't have correct body");
      }
    }
  } else {
    attemptToSendMessageTo(adminID, pageID, "Message doesn't appear to have correct phone number:" + phoneNumber);
  }
}

function handleIncomingPhoneRegistration(senderID, pageID, text) {
  try {
    let phoneNumber = phoneUtil.parse(text, 'US');
    if (phoneUtil.isValidNumber(phoneNumber)) {
      let formattedPhoneNumber = phoneUtil.format(phoneNumber, PNF.E164);
      // drop ""+1" from phone number
      let dbPhoneNumber = formattedPhoneNumber.slice(2);
      log("Saving dbPhoneNumber=", dbPhoneNumber);
      savePhoneNumberToUserWith(senderID, pageID, dbPhoneNumber);
      chatFlowByPageID[pageID][senderID].registeringPhone = false;
      attemptToSendMessageTo(senderID, pageID, "Great, thanks for registering! You will now start receiving messages from us with updates on your car repair status on your messenger");
    } else {
      return attemptToSendMessageTo(senderID, pageID, text + " does not appear as a correct phone number. Please try again.");
    }
  } catch (err) {
    return attemptToSendMessageTo(senderID, pageID, err + ". Please try again.");
  }
}

function handleMessage(senderID, pageID, text) {
  if (pageInfos[pageID].adminIDs.has(senderID)) {
    if (text === eraseCommand)  {
      eraseDB();
      attemptToSendMessageTo(senderID, pageID, "DB erased");
    } else {
      handleIncomingMessageFromAdmin(senderID, pageID, text);
    }
  } else {
    fetchUserModelByPSID(senderID, pageID, function(targetUser) {
      if (!targetUser || !targetUser.phoneNumber) {
        if (chatFlowByPageID[pageID].hasOwnProperty(senderID)) {
          let userChatFlow = chatFlowByPageID[pageID][senderID];
          if (userChatFlow.registeringPhone) {
            return handleIncomingPhoneRegistration(senderID, pageID, text);
          }

          log(`Unhandled message from ${senderID} with ${text}`);
        }
      } else if (targetUser) {
        log(`User has phone number ${targetUser.phoneNumber}, but we don't know what to do with user`);
      }
    });
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

      lazyInitDB();

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
      let message = new CarStatusMessage(dict, pageInfos[dict.pageID], log);
      let targetPhoneNumber = "+1" + dict.phone;
      if (!ignoreList.has(targetPhoneNumber)) {
        log("Sending message to page id", dict.pageID);
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
      for (let adminID of pageInfos[pageID].adminIDs) {
        attemptToSendMessageTo(adminID, pageID, messageForAdmin);
      }
      return res.status(200);
    });
  }
}

// utility functions
function textFromMessage(message) {
  return message.text.substring(0, 320).trim();
}

module.exports = MyBot;
