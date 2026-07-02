var COMPASS_MAIL_SECRET_PROPERTY = "COMPASS_MAIL_SECRET";
var COMPASS_MAIL_SENT_IDS_PROPERTY = "COMPASS_MAIL_SENT_IDS";
var COMPASS_DRIVE_FOLDER_ID_PROPERTY = "COMPASS_DRIVE_FOLDER_ID";
var COMPASS_DRIVE_UPLOAD_SECRET_PROPERTY = "COMPASS_DRIVE_UPLOAD_SECRET";

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
    var payload = {};
    var isFormPayload = Boolean(event && event.parameter && event.parameter.payload);
    if (isFormPayload) {
      payload = JSON.parse(event.parameter.payload || "{}");
    } else {
      payload = JSON.parse(source || "{}");
    }

    if (payload.action === "drive.upload") {
      return driveUploadResponse(payload);
    }

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

function setupCompassDriveUpload(folderId, uploadSecret) {
  var props = PropertiesService.getScriptProperties();
  var folder = null;
  if (folderId) {
    folder = DriveApp.getFolderById(String(folderId).trim());
  } else {
    folder = DriveApp.createFolder("Compass Attachments");
  }
  props.setProperty(COMPASS_DRIVE_FOLDER_ID_PROPERTY, folder.getId());
  if (uploadSecret) {
    props.setProperty(COMPASS_DRIVE_UPLOAD_SECRET_PROPERTY, String(uploadSecret));
  }
  Logger.log("COMPASS_DRIVE_FOLDER_ID=" + folder.getId());
  Logger.log("COMPASS_DRIVE_UPLOAD_SECRET=" + (uploadSecret ? String(uploadSecret) : "(not set)"));
  return {
    folderId: folder.getId(),
    folderUrl: folder.getUrl()
  };
}

function driveUploadResponse(payload) {
  var response;
  try {
    response = handleDriveUpload(payload);
  } catch (error) {
    response = {
      ok: false,
      requestId: payload && payload.requestId ? payload.requestId : "",
      error: error && error.message ? error.message : String(error)
    };
  }
  return postMessageResponse(response);
}

function handleDriveUpload(payload) {
  var props = PropertiesService.getScriptProperties();
  var configuredSecret = props.getProperty(COMPASS_DRIVE_UPLOAD_SECRET_PROPERTY)
    || props.getProperty(COMPASS_MAIL_SECRET_PROPERTY)
    || "";
  if (configuredSecret && String(payload.secret || "") !== configuredSecret) {
    throw new Error("Unauthorized");
  }

  var dataUrl = String(payload.dataUrl || "");
  var match = dataUrl.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/);
  if (!match) throw new Error("Invalid file payload");

  var mimeType = String(payload.mimeType || match[1] || "application/octet-stream");
  var fileName = sanitizeFileName(payload.fileName || "compass-attachment");
  var bytes = Utilities.base64Decode(match[2]);
  var blob = Utilities.newBlob(bytes, mimeType, fileName);
  var folder = getCompassDriveFolder();
  var file = folder.createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (shareError) {
    Logger.log("Sharing skipped: " + shareError);
  }

  return {
    ok: true,
    requestId: payload.requestId || "",
    file: {
      name: file.getName(),
      fileId: file.getId(),
      mimeType: file.getMimeType(),
      size: bytes.length,
      url: file.getUrl(),
      webViewLink: file.getUrl(),
      downloadUrl: "https://drive.google.com/uc?export=download&id=" + encodeURIComponent(file.getId()),
      storage: "google_drive",
      uploadedAt: new Date().toISOString()
    }
  };
}

function getCompassDriveFolder() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty(COMPASS_DRIVE_FOLDER_ID_PROPERTY);
  if (folderId) {
    return DriveApp.getFolderById(folderId);
  }
  var folder = DriveApp.createFolder("Compass Attachments");
  props.setProperty(COMPASS_DRIVE_FOLDER_ID_PROPERTY, folder.getId());
  return folder;
}

function sanitizeFileName(value) {
  var name = String(value || "compass-attachment").replace(/[\\/:*?"<>|]+/g, "_").trim();
  return name || "compass-attachment";
}

function postMessageResponse(payload) {
  var json = JSON.stringify(payload).replace(/</g, "\\u003c");
  var html = "<!doctype html><html><body><script>"
    + "window.parent.postMessage(" + json + ", '*');"
    + "</script></body></html>";
  return HtmlService
    .createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
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
