const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);

var googleMapsClient = require('@google/maps').createClient({
  key: ''
});

var stripe = require("stripe")("");

exports.newUserRegistered = functions.database.ref('/users/userinfo/{userID}').onWrite(event => {
	
	const original = event.data.val();

	// set up default mlvars/user profile
	admin.database().ref('/mlvars/user/' + event.params.userID).set({
							weighting:100,
							cancelations:100,
							cancelationtimes:100,
							sharedratings:100,
							isDriver:original.signedupasdriver,
							driverspecific:{
								latetoworktime:100,
								timeslatetowork:100
							},
							riderspecific:{
								driverwaittime:100
							}
						});


	stripe.accounts.create({
		country: "CA",
		type: "custom"
	}).then(function(acct) {
	 	// asynchronously called
	 	let stripeID = acct.id;
	 	admin.database().ref('/users/financial/' + event.params.userID).set({
							stripeid: stripeID
						});
	});

});







