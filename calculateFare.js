const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);

var googleMapsClient = require('@google/maps').createClient({
  key: ''
});

var stripe = require("stripe")("");

exports.calculateFare = functions.https.onRequest((req, res) => {
	// req format = {"businessuid":"<biz_UID>","bizlocationid":"<bizloc_ID>","lat":0.0,"lng":0.0}
	console.log("calculateFare fired")
	const paymentRadii = [10, 20, 30];
	const paymentPercentages = [0.6, 0.75, 0.9];

	const bizUID = req.body.businessuid;
	const bizLocUID = req.body.bizlocationid;
	const pickupLoc = {lat:req.body.lat, lng:req.body.lng};

	console.log("bizUID = " + bizUID);

	admin.database().ref('business/fare/' + bizUID).once('value').then(function(snapshot) {
		var fareData = snapshot.val();
		const fare = fareData.maxcostperride;
		console.log("fare = " + fare);
		admin.database().ref('business/locations/' + bizUID + '/' + bizLocUID + '/location').once('value').then(function(locSnapshot) {
			var bizLocData = locSnapshot.val();
			const bizLoc = {lat: bizLocData.lat, lng: bizLocData.lng};

			const distance = getDistanceFromLatLonInKm(pickupLoc.lat,pickupLoc.lng,bizLoc.lat,bizLoc.lng);
			console.log("distance = " + distance);
			var radiiIndex = 0
			for (var i=0;i<paymentRadii.length;i++) {
				if (distance >= paymentRadii[i]) {
					radiiIndex = i;
				}
			}
			const maxPayment = fare * paymentPercentages[radiiIndex] / 2;
			console.log("maxPayment = " + maxPayment);
			res.status(200).send({maxPayment: maxPayment});
		});
	});
});




