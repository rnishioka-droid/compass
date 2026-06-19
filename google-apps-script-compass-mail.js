var COMPASS_MAIL_SECRET_PROPERTY = "COMPASS_MAIL_SECRET";
var COMPASS_MAIL_SENT_IDS_PROPERTY = "COMPASS_MAIL_SENT_IDS";

function initializeCompassMailSecret() {
  var secret = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, "");
  var props = PropertiesService.getScriptProperties();
  props.setProperty(COMPASS_MAIL_SECRET_PROPERTY, secret);
  Logger.log("GAS_MAIL_SECRET=" + secret);
  return secret;
}

function doGet() {
  return jsonResponse({
    ok: true,
    service: "Compass Gmail notification"
  });
}

function doPost(event) {
  try {
    var source = event && event.postData ? event.postData.contents : "{}";
    var payload = JSON.parse(source || "{}");
    var props = PropertiesService.getScriptProperties();
    var configuredSecret = props.getProperty(COMPASS_MAIL_SECRET_PROPERTY);

    if (!configuredSecret || payload.secret !== configuredSecret) {
      return jsonResponse({ ok: false, error: "Unauthorized" });
    }

    var notificationId = String(payload.notificationId || "").trim();
    var to = String(payload.to || "").trim();
    var subject = String(payload.subject || "Compass notification").trim();
    var text = String(payload.text || "").trim();

    if (!notificationId || !to || !text) {
      return jsonResponse({
        ok: false,
        error: "Required mail fields are missing"
      });
    }

    var sentIds = JSON.parse(
      props.getProperty(COMPASS_MAIL_SENT_IDS_PROPERTY) || "[]"
    );
    if (sentIds.indexOf(notificationId) !== -1) {
      return jsonResponse({
        ok: true,
        duplicate: true,
        messageId: notificationId
      });
    }

    GmailApp.sendEmail(to, subject, text, {
      name: "Compass"
    });

    sentIds.push(notificationId);
    if (sentIds.length > 1000) {
      sentIds = sentIds.slice(sentIds.length - 1000);
    }
    props.setProperty(
      COMPASS_MAIL_SENT_IDS_PROPERTY,
      JSON.stringify(sentIds)
    );

    return jsonResponse({
      ok: true,
      messageId: notificationId
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: error && error.message ? error.message : String(error)
    });
  }
}

function sendCompassTestMail() {
  var recipient = Session.getEffectiveUser().getEmail();
  if (!recipient) {
    throw new Error("Test recipient was not found.");
  }
  GmailApp.sendEmail(
    recipient,
    "Compass Gmail notification test",
    "This is a Compass Gmail notification test.",
    { name: "Compass" }
  );
  Logger.log("Test mail sent to: " + recipient);
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
