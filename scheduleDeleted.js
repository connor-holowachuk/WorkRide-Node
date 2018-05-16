const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);

var googleMapsClient = require('@google/maps').createClient({
  key: ''
});

var stripe = require("stripe")("");

exports.scheduleDeleted = functions.database.ref('/users/schedule/{userID}/{year}/{month}/{day}').onDelete(event => {
	const original = event.data.val();
	const toRouteID = original.to.id;
	const toClockTime = original.to.time;
	if (toRouteID != "") {
		
		admin.database().ref('/users/pickupinfo/' + event.params.userID).once('value').then(function(snapshotLoc) {
			const locationData = snapshotLoc.val();
			const isDriver = locationData.isdriver;
			const bizUID = locationData.businessuid;
			if (isDriver) {
				// take to riders and place into pending
				admin.database().ref('/rides/' + bizUID + '/' + toClockTime + '/queue/' + toRouteID).once('value').then(function(snapshotRoute) {
					const routeData = snapshotRoute.val();
					if(routeData.hasChild("riders")) {
						const riderData = routeData.riders;
						
					}

				});
			} else {

			}
		});
	} else {

	}

});







