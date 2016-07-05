'use strict';

let service = Object.create(null);

// service.log = console.log;
// service.request = null;

// functions to work with facebook messaging
service.postbackPayload = (buttonTitle, payload) => {
  return {
    type: "postback",
    title: buttonTitle,
    payload: payload
  };
};

service.templateWithImageURLTitleSubtitleAndButtons = (imageURL, title, subtitle, buttonsArray) =>  {
  return {
    attachment: {
      type: "template",
      payload: {
        template_type: "generic",
        elements: [
          {
            title: title,
            image_url: imageURL,
            subtitle: subtitle,
            buttons: buttonsArray
          }
        ]
      }
    }
  };
};

service.formMessageDataWithTextAndButtons = (text, buttonsArray) =>  {
  return {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text: text,
        buttons: buttonsArray
      }
    }
  };
};

service.sendFacebookTextMessage = (senderID, pageToken, text) =>  {
  let messageData = {
    text: text
  };

  service.postMessageDataToPageSenderID(senderID, pageToken, messageData);
};

service.postMessageDataToPhoneNumber = (phoneNumber, pageID, messageData, completion) =>  {
  let recipientInfo = { phone_number: phoneNumber };
  service.postMessageDataRecipient(recipientInfo, pageInfos[pageID].token, messageData, completion);
};

service.postMessageDataToPageSenderID = (senderID, pageToken, messageData, completion) =>  {
  if (ignoreList.has(senderID)) {
    if (completion) {
      completion(senderID + " is in the block group");
    }
    return;
  }

  let recipientInfo = { id: senderID };
  service.postMessageDataRecipient(recipientInfo, pageToken, messageData, completion);
};

// recipientInfo can be eeither
// { phone_number: senderPhoneNumber }
// { id: sender }
service.postMessageDataRecipient = (recipientInfo, pageToken, messageData, completion) =>  {
  service.log("pageToken: ", pageToken);
  service.log("messageData: ", JSON.stringify(messageData));
  service.request({
    url: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: pageToken },
    method: 'POST',
    json: {
      recipient: recipientInfo,
      message: messageData
    }
  }, function (error, response) {
    if (error) {
      service.log('Error sending message: ', error);
      if (completion) {
        completion(error);
      }
    } else if (response.body.error) {
      service.log('Error: ', response.body.error);
      service.log("about to call completion block");
      if (completion) {
        service.log("calling completion block");
        completion(response.body.error);
      }
    } else {
      if (completion) {
        completion();
      }
    }
  });
};

service.setWelcomeMessage = (pageID, token, message) => {
  service.request({
    url: 'https://graph.facebook.com/v2.6/' + pageID + '/thread_settings?access_token=' + token,
    method: 'POST',
    json: {
      setting_type: "greeting",
      greeting: {
        "text" : message
      }
    }
  }, function (error, response) {
    if (error || response.body.error) {
      log('Failed to sent greeting: ', error || response.body.error);
    }
  });
};

service.setCallToActions = (pageID, token, threadState, callToActionsArrray) => {
  service.request({
    url: 'https://graph.facebook.com/v2.6/' + pageID + '/thread_settings?access_token=' + token,
    method: 'POST',
    json: {
      setting_type: "call_to_actions",
      thread_state: threadState,
      call_to_actions: callToActionsArrray
    }
  }, function (error, response) {
    if (error || response.body.error) {
      log('Failed to sent call to actions for pageID / thread_state / error: ', pageID, threadState, error || response.body.error);
    }
  });
};

module.exports = service;
