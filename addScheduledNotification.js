const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);

var googleMapsClient = require('@google/maps').createClient({
  key: ''
});

var stripe = require("stripe")("");

exports.addScheduledNotification = functions.database.ref('/users/schedule/{userID}/{year}/{month}/{day}').onWrite(event => {
	// output format -> {"to":{"time":0,"id":"","ismatched":false},"from":{"time":0,"id":"","ismatched":false}}
	const original = event.data.val();
	const toRouteID = original.to.id;

	if (toRouteID != "") {
		// check if user is driver
		const uid = event.params.userID;
		admin.database().ref('/users/userinfo/' + uid).once('value').then(function(userInfoSnapshot) {
			if (userInfoSnapshot.hasChildren()) {
				const userInfoData = userInfoSnapshot.val();
				const isDriver = userInfoData.signedupasdriver;
				if (isDriver) {
					// user is driver
					// get pre-trip notification time from mlvars/global
					admin.database().ref('/mlvars/global').once('value').then(function(mlvarsSnapshot) {
						if (userInfoSnapshot.hasChildren()) {
							const mlvarsData = mlvarsSnapshot.val();
							const leaveTimeBefore = mlvarsData.leavetimebefore;

							const tripLeaveTime = original.to.time;
							const tripLeaveDayTime = original.to.daytime;
							const alertTime = tripLeaveTime - leaveTimeBefore;

							const tripLeaveTimeMin = tripLeaveDayTime % 60;
							const tripLeaveTimeHour = (tripLeaveDayTime - (tripLeaveTimeMin)) / 60;
							var tripLeaveMessageTitle = "Leave by " + tripLeaveTimeHour + ":" + tripLeaveTimeMin + "am"
							if (tripLeaveTimeHour > 12) {
								const pmTripHour = tripLeaveTimeHour - 12;
								tripLeaveMessageTitle = "Leave by " + pmTripHour + ":" + tripLeaveTimeMin + "pm"
							}

							const tripLeaveMessageBody = "Leave in the next " + leaveTimeBefore + " minutes to be on time for work."

							admin.database().ref('/notifications/scheduled/' + alertTime + '/' + uid).set({
								title: tripLeaveMessageTitle,
								body: tripLeaveMessageBody
							});
						}
					});
				} 
			}
		});
	}
});


