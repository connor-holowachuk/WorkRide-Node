const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);

var googleMapsClient = require('@google/maps').createClient({
  key: ''
});

var stripe = require("stripe")("");

function sendNotification(uid, notificationData, clockTime) {
	// get device token for user
	admin.database().ref('/notifications/deviceid/' + uid).once('value').then(function(deviceIDSnapshot) {
		if (deviceIDSnapshot.hasChildren()) {
			const deviceIDData = deviceIDSnapshot.val();
			const deviceToken = deviceIDData.token;

			if (deviceToken == "") {
				console.log('blank device token stored for ' + uid);
			} else {
				const payloadData = notificationData[uid];
				const title = payloadData.title;
				const body = uid;

				// Notification details.
				const payload = {
					notification: {
						title: title,
						body: body,
						sound: "notification-audio.m4a"
					}
				};
				console.log('sending to ' + uid);

				// Send notifications to all tokens.
				return admin.messaging().sendToDevice(deviceToken, payload).then(response => {
					admin.database().ref('/notifications/scheduled/' + clockTime + '/' + uid).remove();
				});
			}
		} else {
			console.log('no device token stored for ' + key);
		}
		onUID += 1;
	});
}


