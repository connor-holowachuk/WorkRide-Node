const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);

var googleMapsClient = require('@google/maps').createClient({
  key: ''
});

var stripe = require("stripe")("");


exports.updateServerClock = functions.https.onRequest((req, res) => {
	var serverClockTime = req.body.clockTime;
	serverClockTime = parseInt(serverClockTime);

	

	admin.database().ref('/notifications/clock').set(serverClockTime).then(snapshot => {
		console.log("clock time updated - " + serverClockTime);
		res.status(200).send("all good");
	});

	// look for existing data under current server time
	

	admin.database().ref('/notifications/scheduled/' + serverClockTime).once('value').then(function(currentSchedNotsSnapshot) {
		if (!currentSchedNotsSnapshot.hasChildren()) {
			console.log('no notifications to send - ' + serverClockTime);
		} else {

			const notificationData = currentSchedNotsSnapshot.val();

			for (var key in notificationData) {
				if (notificationData.hasOwnProperty(key)) {
					// 'key' is user uid
					
					sendNotification(key, notificationData, serverClockTime);
				}
			}
		}
	});
});


