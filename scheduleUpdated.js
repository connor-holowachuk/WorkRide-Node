const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);

var googleMapsClient = require('@google/maps').createClient({
  key: ''
});

var stripe = require("stripe")("");

exports.scheduleUpdated = functions.database.ref('/users/schedule/{userID}/{year}/{month}/{day}').onCreate(event => {
	// output format -> {"to":{"time":0,"id":"","ismatched":false},"from":{"time":0,"id":"","ismatched":false}}
	const original = event.data.val();
	const toRouteID = original.to.id;

	console.log('scheduleUpdated.', 'User uid: ' + event.params.userID + '.', 'Full data set: ' + original);


	if (toRouteID == "") {
		var locRunCount = 0;
		admin.database().ref('/users/pickupinfo/' + event.params.userID).once('value').then(function(snapshotLoc) {
			if (locRunCount == 0) {
			/* 
			//	
			//	PULL PICKUP INFORMATION FOR USER FIRING FUNCTION
			//	STORE IN locationData
			//
			*/

			const locationData = snapshotLoc.val();


			var bizRunCount = 0;
			admin.database().ref('/business/locations/' + locationData.businessuid + '/' + locationData.businesslocationid + '/location').once('value').then(function(snapshotBiz) {
				if (bizRunCount == 0){
				/* 
				//	
				//	PULL BUSINESS INFORMATION AT LOCATION ID FOR USER FIRING FUNCTION
				//	STORE IN businessData
				//	businessData contains lat, lng of business location for businesslocationid
				//
				*/

				bizRunCount += 1;


				const businessData = snapshotBiz.val();


				// send user origin and business loc to Google Directions API to find default route
				googleMapsClient.directions({
					origin: {lat: locationData.lat, lng: locationData.lng},
					destination: {lat: businessData.lat, lng: businessData.lng},
					mode: 'driving'
		        }, function(err, resp) {

		        	// calculate norm distance and norm time for user to arrive at work from home
					var totalDist = 0; 																	// norm travel distance for user to get between home and work (meters)
					var totalTime = 0; 																	// norm travel time for user to get between home and work (secs)
					const legsData = resp.json.routes[0].legs;
					for (var i=0;i<legsData.length;i++){
						const legDist = legsData[i].distance.value;
						const legTime = legsData[i].duration.value;
						totalDist += legDist;
						totalTime += legTime;
					}
					const totalTimeMins = (totalTime - (totalTime % 60)) / 60;							// norm travel time for user to get between home and work (mins)





					/* 
					//	************************
					//	LOOK AT "TO" DATA
					//	******** TO **********
					//	************************
					*/

					// look at rides/<biz_uid>/to/<time> for .exists()
					const rideTimeRef = '/rides/' + locationData.businessuid + '/' + locationData.businesslocationid + '/to/' + original.to.time;

					var toRidesRunCount = 0;
					admin.database().ref(rideTimeRef).once('value').then(function(snapshotRides) {
						/* 
						//	
						//	LOOK AT 'TO' RIDE DATA UNDER RIDES/<BIZ_UID>/<LOC_ID>/TO/<TO_TIME>
						//	TO
						//
						*/


						if (toRidesRunCount == 0) {
						const rideTimeExists = snapshotRides.exists();

						if (locationData.isdriver == true) {
							/* 
							//	
							//	USER TRIGGERING FUNCTION IS DRIVER
							//	TO / DRIVER
							//
							*/

							console.log("user is driver");


							// check if rides exist under ride time ref 
							if (rideTimeExists == true) {
								/* 
								//	
								//	DATA EXISTS UNDER RIDE TIME REF
								//	TO / DRIVER / RIDE TIMES EXIST
								//
								*/

								console.log('rides exist with time = ' + original.to.time);


								// push driver data into queue as empty ride awaiting riders
								const leaveTime = original.to.time - totalTimeMins;
								const leaveDayTime = original.to.daytime - totalTimeMins;
								let newRideKey = admin.database().ref(rideTimeRef).push().key;
								admin.database().ref(rideTimeRef + '/queue/' + newRideKey).set({
									driveruid: event.params.userID,
									driverfirstname: locationData.firstname,
									driverlat: locationData.lat,
									driverlng: locationData.lng,
									drivernormtime: totalTimeMins,
									drivernormdist: totalDist,
									leavetime: leaveTime,
									leavedaytime: leaveDayTime,
									arrivetime: original.to.time,
									arrivedaytime: original.to.daytime,
									totalseats: locationData.seats
								});


								// check if pending riders exist
								var pendingRunCount = 0
								admin.database().ref(rideTimeRef + '/pending').once('value').then(function(snapshotPending) {
									if (pendingRunCount == 0) {

									const pendingExists = snapshotPending.exists();
									if (pendingExists == true) {
										/* 
										//	
										//	WAITING RIDER DATA EXISTS IN 'PENDING' UNDER RIDE TIME REF
										//	TO / DRIVER / RIDE TIMES EXIST / PENDING RIDERS EXIST
										//
										*/


										var pendingData = snapshotPending.val();
										admin.database().ref('/test/a').set(pendingData);
										const numberOfSeatsOpen = locationData.seats;
										const driverLocation = {lat:locationData.lat, lng:locationData.lng};


										var remainingRiders = pendingData;
										var lastLocation = driverLocation;
										var selectedRiderUIDs = [];
										while (numberOfSeatsOpen > selectedRiderUIDs.length) {
											if (remainingRiders.length > 0) {

												var minDist = 1000000;
												var selectedUID = "";
												var selectedLocation = lastLocation;
												var spliceAtIndex = 0;

												for (var i = 0; i < remainingRiders.length; i++) {
													const currentRiderLocation = {lat:remainingRiders[i].lat, lng:remainingRiders[i].lng};
													var legLatDiff = lastLocation.lat - currentRiderLocation.lat;
													var legLngDiff = lastLocation.lng - currentRiderLocation.lng;
													var legDist = Math.sqrt((legLatDiff * legLatDiff) + (legLngDiff * legLngDiff));
													if (minDist >= legDist) {
														minDist = legDist;
														selectedUID = remainingRiders[i].uid;
														selectedLocation = currentRiderLocation;
														spliceAtIndex = i;
													}
												}

												selectedRiderUIDs.push(selectedUID);
												lastLocation = selectedLocation;
												remainingRiders.splice(spliceAtIndex, 1);

											} else { break; }
										}

										pendingData = snapshotPending.val();

										// update rideID for user firing function
										admin.database().ref('/users/schedule/' + event.params.userID + '/' + event.params.year + '/' + event.params.month + '/' + event.params.day + '/to').set({
											id: newRideKey,
											ismatched: true,
											time: original.to.time,
											daytime: original.to.daytime
										});

										console.log("a");
										var ridersData = [];
										var riderLocations = [];
										
										console.log("pendingData = " + pendingData + ", length = " + pendingData.length);
										for (var i = 0; i < selectedRiderUIDs.length; i++) {
											for (var j = 0; j < pendingData.length; j++) {
												console.log("j = " + j + ", uid = " + pendingData[j].uid);
												if (selectedRiderUIDs[i] == pendingData[j].uid) {
													console.log("its zee match");
													ridersData.push(pendingData[j]);
													var riderLoc = {lat:pendingData[j].lat, lng:pendingData[j].lng};
													riderLocations.push(riderLoc);

													admin.database().ref('/users/schedule/' + selectedRiderUIDs[i] + '/' + event.params.year + '/' + event.params.month + '/' + event.params.day + '/to').set({
														id: newRideKey,
														ismatched: true,
														time: original.to.time,
														daytime: original.to.daytime
													});
												}
											}
										}

										var remainingPendingData = pendingData;
										for (var i = 0; i < selectedRiderUIDs.length; i++) {
											for (var j = 0; j < remainingPendingData.length; j++) {
												if (selectedRiderUIDs[i] == remainingPendingData[j].uid) {
													remainingPendingData.splice(j, 1);
												}
											}
										}
										admin.database().ref(rideTimeRef + '/queue/' + newRideKey + '/riders').set(ridersData);
										admin.database().ref(rideTimeRef + '/pending').set(remainingPendingData);
										

										googleMapsClient.directions({
											origin: {lat:locationData.lat, lng:locationData.lng},
											destination: {lat: businessData.lat, lng: businessData.lng},
											mode: 'driving',
											waypoints: riderLocations,
											optimize: true
								        }, function(errB, respB) {
								        	const routeLegsData = respB.json.routes[0].legs;
											const waypointOrder = respB.json.routes[0].waypoint_order;


											var totalRouteDist = 0;
											var totalRouteTime = 0;
											for (routeIndex in routeLegsData) {
												console.log(newRideKey + " routeIndex: " + routeIndex);
												const currentLegDist = routeLegsData[routeIndex].distance.value;
												const currentLegTime = routeLegsData[routeIndex].duration.value;
												totalRouteDist += currentLegDist;
												totalRouteTime += currentLegTime;
											}

											const newLeaveTime = original.to.time - totalRouteTime;
											admin.database().ref(rideTimeRef + '/queue/' + newRideKey + '/leavetime').set(newLeaveTime);

											for (var riderPreIndex = 0; riderPreIndex < waypointOrder.length; riderPreIndex++) {
												console.log(newRideKey + " rider pre index = " + riderPreIndex);
												console.log(newRideKey + " routeLegsData.length = " + routeLegsData.length);
												const lookingAtRiderIndex = waypointOrder[riderPreIndex];
												console.log(newRideKey + " lookingAtRiderIndex = " + lookingAtRiderIndex);

												var currentRiderDist = 0;
												var currentRiderTime = 0;
												for (var someIndex = riderPreIndex + 1; someIndex < routeLegsData.length; someIndex++) {
													console.log("someIndex = " + someIndex);
													const currentLegDist = routeLegsData[someIndex].distance.value;
													const currentLegTime = routeLegsData[someIndex].duration.value;
													currentRiderDist += currentLegDist;
													currentRiderTime += currentLegTime;
												}

												const currentRiderTimeMins = (currentRiderTime - (currentRiderTime % 60)) / 60;
												console.log(newRideKey + " rider " + riderPreIndex + " final dist = " + currentRiderDist);
												console.log(newRideKey + " rider " + riderPreIndex + " final time = " + currentRiderTime);

												admin.database().ref(rideTimeRef + '/queue/' + newRideKey + '/riders/' + lookingAtRiderIndex + '/normdisttodeliver').set(currentRiderDist);
												admin.database().ref(rideTimeRef + '/queue/' + newRideKey + '/riders/' + lookingAtRiderIndex + '/normtimetodeliver').set(currentRiderTimeMins);
												console.log("finished for rider pre index = " + riderPreIndex);
											}
											console.log("FIN");
								        });
									}

									pendingRunCount += 1;
									}
								});
							} else {
								/* 
								//	
								//	DATA DOES NOT EXIST UNDER RIDE TIME REF
								//	TO / DRIVER / RIDE TIMES DO NOT EXIST
								//
								*/


								console.log('rides do not exist with time = ' + original.to.time);

								// push driver data into queue as empty ride awaiting riders
								const leaveTime = original.to.time - totalTimeMins;
								const leaveDayTime = original.to.daytime - totalTimeMins;
								let newRideKey = admin.database().ref(rideTimeRef).push().key;
								admin.database().ref(rideTimeRef + '/queue/' + newRideKey).set({
									driveruid: event.params.userID,
									driverfirstname: locationData.firstname,
									driverlat: locationData.lat,
									driverlng: locationData.lng,
									drivernormtime: totalTimeMins,
									drivernormdist: totalDist,
									leavetime: leaveTime,
									leavedaytime: leaveDayTime,
									arrivetime: original.to.time,
									arrivedaytime: original.to.daytime,
									totalseats: locationData.seats
								});
								
								// set up schedule ref for ride time
								admin.database().ref(rideTimeRef + '/scheduleref').set({
									schedyear: event.params.year,
									schedmonth: event.params.month,
									schedday: event.params.day,
									daytime: original.to.daytime
								});

								// update ride id
								admin.database().ref('/users/schedule/' + event.params.userID + '/' + event.params.year + '/' + event.params.month + '/' + event.params.day + '/to/id').set(newRideKey);

								
							}
						} else {
							/* 
							//	
							//	USER TRIGGERING FUNCTION IS RIDER
							//	TO / RIDER
							//
							*/
							

							console.log("user is rider");


							if (rideTimeExists == true) {
								/* 
								//	
								//	DATA EXISTS UNDER RIDE TIME REF
								//	TO / RIDER / RIDE TIMES EXIST
								//
								*/

								console.log("ride times exist")


								var queueRunCount = 0
								admin.database().ref(rideTimeRef + '/queue').once('value').then(function(snapshotQueue) {
									if (queueRunCount == 0) {
									queueRunCount += 1;
									const queueExists = snapshotQueue.exists();

									if (queueExists == true) {
										/* 
										//	
										//	DATA EXISTS UNDER QUEUE FOR RIDE TIME REF
										//	TO / RIDER / RIDE TIMES EXIST / QUEUE DATA EXISTS
										//
										*/
										
										const queueData = snapshotQueue.val();

										var routeRatings = [];
										var routeKeys = [];
										var routeData = [];
										var routeTotalTime = [];

										var timesThroughQueueData = 0;
										var maxIndexOfQueueData = 0;
										for (var key in queueData) {
											maxIndexOfQueueData += 1;
										}
										maxIndexOfQueueData -= 1;
										
										var keys = [];
										var indecies = [];
										var originLocs = [];
										var currentIndex = 0;

										var userNormTimes = [];
										var userNormDists = [];
										var userOrigins = [];

										for (var key in queueData) {
											if (queueData.hasOwnProperty(key)) {

										    	var tempUserNormTimes = [];
										    	var tempUserNormDists = [];
										    	var tempUserOrigins = [];

										    	// add current user norm info to arrays
										    	tempUserNormTimes.push(totalTimeMins);
										    	tempUserNormDists.push(totalDist);
										    	tempUserOrigins.push({lat: locationData.lat, lng: locationData.lng});

										    	const riderData = queueData[key].riders;

										    	if (riderData != null) {
										    		console.log(key + " rider data exists");
										    		for (var i in riderData) {
										    			tempUserNormTimes.push(queueData[key].riders[i].normtimetodeliver);
										    			tempUserNormDists.push(queueData[key].riders[i].normdisttodeliver);
										    			tempUserOrigins.push({lat: queueData[key].riders[i].lat, lng: queueData[key].riders[i].lng});
										    		}
										    	} else {
										    		console.log(key + " no rider data exists");
										    	}

												console.log(key + " user norm times: " + tempUserNormTimes);
												console.log(key + " user norm dists: " + tempUserNormDists);
												console.log(key + " user origins: " + tempUserOrigins);
												console.log(key + " loc data: lat = " + queueData[key].driverlat + ", lng = " + queueData[key].driverlng);

												userNormTimes.push(tempUserNormTimes);
												userNormDists.push(tempUserNormDists);
												userOrigins.push(tempUserOrigins);

												keys.push(key);
												originLocs.push({lat: queueData[key].driverlat, lng: queueData[key].driverlng});

												indecies.push(currentIndex);
												currentIndex += 1;

										    	googleMapsClient.directions({
													origin: {lat: queueData[key].driverlat, lng: queueData[key].driverlng},
													destination: {lat: businessData.lat, lng: businessData.lng},
													mode: 'driving',
													waypoints: tempUserOrigins,
													optimize: true
										        }, function(errB, respB) {
										        	console.log()
										        	
										        	console.log("here bruhhh");
										        	const testRouteLegsData = respB.json.routes[0].legs;
													const waypointOrder = respB.json.routes[0].waypoint_order;
													console.log("waypointOrder = " + waypointOrder);
													// get current key cause it's fuckin asynch. :'(
										        	var currentKey = "";
										        	var currentDataIndex = 0;

										        	console.log("start loc = lat:" + testRouteLegsData[0].start_location.lat); //+ ", lng:" + testRouteLegsData[0].start_location.lng);
										        	var minCummulativeDiff = 100000;
										        	for (var i = 0; i < originLocs.length; i++) {
										        		//console.log("i = " + i);
										        		const newLatDiff = testRouteLegsData[0].start_location.lat - originLocs[i].lat;
										        		//console.log("newLatDiff = " + newLatDiff);
										        		const newLngDiff = testRouteLegsData[0].start_location.lng - originLocs[i].lng;
										        		//console.log("newLngDiff = " + newLngDiff);
										        		const cummulativeDiff = Math.abs(newLatDiff) + Math.abs(newLngDiff);
										        		//console.log("looping with i = " + i + " of originLocs.length. cummulativeDiff = " + cummulativeDiff);
										        		if (cummulativeDiff <= minCummulativeDiff) {
										        			console.log("new min diff = " + cummulativeDiff);
										        			minCummulativeDiff = cummulativeDiff;
										        			currentKey = keys[i];
										        			currentDataIndex = indecies[i];
										        		}
										        	}

										        	console.log("current key = " + currentKey);
										        	console.log("current data index = " + currentDataIndex);
										        	console.log("userNormTimes[" + currentDataIndex + "] = " + userNormTimes[currentDataIndex]);

										        	

										        	
										        	//console.log(key + " error = " + errB);
													
													console.log(currentKey + " testRouteLegsData: " + testRouteLegsData);
													console.log(currentKey + " waypoint order: " + waypointOrder);
													var riderRatings = [];


													var totalRouteDist = 0;
													var totalRouteTime = 0;
													for (testRouteIndex in testRouteLegsData) {
														console.log(currentKey + " testRouteIndex: " + testRouteIndex);
														const currentLegDist = testRouteLegsData[testRouteIndex].distance.value;
														const currentLegTime = testRouteLegsData[testRouteIndex].duration.value;
														totalRouteDist += currentLegDist;
														totalRouteTime += currentLegTime;
													}

													// add driver rating to riderRatings[]
													const driverRating = getRiderRating(queueData[currentKey].drivernormtime, queueData[currentKey].drivernormdist, totalRouteTime, totalRouteDist);
													riderRatings.push(driverRating);
													console.log(currentKey + ' driver rating: ' + driverRating);

													// calculate rider ratings
													for (var riderPreIndex = 0; riderPreIndex < waypointOrder.length; riderPreIndex++) {
														console.log(currentKey + " rider pre index = " + riderPreIndex);
														console.log(currentKey + " testRouteLegsData.length = " + testRouteLegsData.length);
														const lookingAtRiderIndex = waypointOrder[riderPreIndex];

														const currentRiderNormDist = userNormDists[currentDataIndex][lookingAtRiderIndex];
														const currentRiderNormTime = userNormTimes[currentDataIndex][lookingAtRiderIndex];

														var currentRiderDist = 0;
														var currentRiderTime = 0;
														console.log(currentKey + " rider " + riderPreIndex + " norm dist = " + currentRiderNormDist);
														console.log(currentKey + " rider " + riderPreIndex + " norm time = " + currentRiderNormTime);

														for (var someIndex = riderPreIndex + 1; someIndex < testRouteLegsData.length; someIndex++) {
															const currentLegDist = testRouteLegsData[someIndex].distance.value;
															const currentLegTime = testRouteLegsData[someIndex].duration.value / 60;
															//console.log("leg " + someIndex + " dist = " + currentLegDist + ", leg " + someIndex + " time = " + currentLegTime);

															currentRiderDist += currentLegDist;
															currentRiderTime += currentLegTime;
														}


														console.log(currentKey + " rider " + riderPreIndex + " final dist = " + currentRiderDist);
														console.log(currentKey + " rider " + riderPreIndex + " final time = " + currentRiderTime);

														const riderRating = getRiderRating(currentRiderNormTime, currentRiderNormDist, currentRiderTime, currentRiderDist);
														riderRatings.push(riderRating);
														console.log(currentKey + " rider " + riderPreIndex + " rating: " + riderRating);
													}
													console.log(currentKey + " riderRatings = " + riderRatings);
													console.log(currentKey + " rider rating length = " + riderRatings.length);
													// calculate final route rating
													var finalRating = driverRating;
													for (var riderIndex = 0; riderIndex < riderRatings.length; riderIndex++) { 
														finalRating += riderRatings[riderIndex];
													} 
													finalRating /= riderRatings.length + 1;
													console.log(currentKey + " finalRating = " + finalRating);
													routeRatings.push(finalRating);
													routeKeys.push(currentKey);
													routeData.push(respB.json.routes[0]);
													routeTotalTime.push(totalRouteTime);
													
													if (timesThroughQueueData == maxIndexOfQueueData) {
														console.log("finished rating routes.")
														console.log("finished rating routes with max index = " + maxIndexOfQueueData);
														console.log("routeRatings = " + routeRatings);
														var maxRatingIndex = 0;
														var maxRating = 0;
														for (var ratingIndex = 0; ratingIndex < routeRatings.length; ratingIndex++) {
															console.log("rating index in for loop = " + ratingIndex);
															if (routeRatings[ratingIndex] > maxRating) {
																maxRating = routeRatings[ratingIndex];
																maxRatingIndex = ratingIndex;
															}
														}
														console.log("max rating index = " + maxRatingIndex);

														

														const maxRatingKey = routeKeys[maxRatingIndex];
														const chosenRouteRouteData = routeData[maxRatingIndex];
														const chosenRouteInfoData = queueData[maxRatingKey];
														const chosenRouteTotalTime = routeTotalTime[maxRatingIndex];
														

														console.log("max rating = " + maxRating);
														console.log("max rating key = " + maxRatingKey);
														console.log("queueData[" + maxRatingKey +"] = " + queueData[maxRatingKey]);
														const currentRouteRiderData = chosenRouteInfoData.riders;
														var currentNumberOfRiders = 0;
														if (currentRouteRiderData != null) {
															currentNumberOfRiders = chosenRouteInfoData.riders.length;
														}
														
														console.log("number of riders = " + currentNumberOfRiders);

														console.log("b");

														// change leave time
														const rideRef = '/rides/' + locationData.businessuid + '/' + locationData.businesslocationid + '/to/' + original.to.time + '/queue/' + maxRatingKey;
														const chosenRouteTotalTimeMins = (chosenRouteTotalTime - (chosenRouteTotalTime % 60)) / 60;
														console.log("chosenRouteTotalTime = " + chosenRouteTotalTime + ", chosenRouteTotalTimeMins = " + chosenRouteTotalTimeMins + ", original.to.time = " + original.to.time);
														const leaveTime = original.to.time - chosenRouteTotalTimeMins;
														admin.database().ref(rideRef + '/leavetime').set(leaveTime);

														// change pickup times for riders
														const chosenRouteWaypointOrder = chosenRouteRouteData.waypoint_order;
														console.log("waypoint order = " + chosenRouteWaypointOrder);
														var accumulatedTime = 0;
														var currentUserMeetTime = 0;
														for (var i = 0; i < chosenRouteWaypointOrder.length; i++) {
															console.log("loopin...");
															const currentWaypoint = chosenRouteWaypointOrder[i];
															console.log("i = " + i + ", current waypoint = " + currentWaypoint);
															const waypointLegTime = chosenRouteRouteData.legs[i].duration.value;
															console.log("waypoint leg time = " + waypointLegTime);
															const waypointLegTimeMins = (waypointLegTime - (waypointLegTime % 60)) / 60;

															accumulatedTime += waypointLegTimeMins;
															const currentMeetTime = leaveTime + accumulatedTime;
															console.log("leaveTime = " + leaveTime);
															if (currentWaypoint == 0) {
																console.log("current user waypoint");
																currentUserMeetTime = currentMeetTime;
															} else {
																console.log("waypoint with index = " + currentWaypoint);
																admin.database().ref(rideRef + '/riders/' + (currentWaypoint - 1) + '/meettime').set(currentMeetTime);
															}
														}


														// add current user to riders[]
														admin.database().ref(rideRef + '/riders/' + currentNumberOfRiders).set({
															lat: locationData.lat,
															lng: locationData.lng,
															meettime: currentUserMeetTime,
															normdisttodeliver: totalDist,
															normtimetodeliver: totalTimeMins,
															firstname: locationData.firstname,
															uid: event.params.userID,
															fare: locationData.fare
														});


														// change id and ismatched in schedule ref
														admin.database().ref('/users/schedule/' + event.params.userID + '/' + event.params.year + '/' + event.params.month + '/' + event.params.day + '/to').set({
															id: maxRatingKey,
															ismatched: true,
															time: original.to.time,
															daytime: original.to.daytime
														});


														// check if vehicle is now full
														const newNumberOfRiders = currentNumberOfRiders + 1;
														console.log("newNumberOfRiders = " + newNumberOfRiders);
														if (newNumberOfRiders >= chosenRouteInfoData.totalseats) {
															// vehicle is full - move data to ../rides/full
															console.log("vehicle is full.");
															var timesThroughChosenRoute = 0;
															admin.database().ref(rideTimeRef + '/queue/' + maxRatingKey).once('value').then(function(snapshotChosenRoute) {

																if (timesThroughChosenRoute == 0) {
																	timesThroughChosenRoute += 1;

																	const chosenRouteData = snapshotChosenRoute.val();
																	admin.database().ref(rideTimeRef + '/full/' + maxRatingKey).set(chosenRouteData);
																	admin.database().ref(rideTimeRef + '/queue/' + maxRatingKey).remove();
																	console.log("FIN");
																}
															});
														}
													}
													timesThroughQueueData += 1;
										        });
										    }
										}
									} else {
										console.log("queue does not exist");
									}
									}
								});
							} else {
								/* 
								//	
								//	NO PREVIOUS ENTRIES EXIST UNDER GIVEN RIDE TIME
								//	TO / RIDER / RIDE TIMES DO NOT EXIST
								//
								*/


								console.log("ride times do not exist");
								// set up schedule ref for ride time
								const leaveTime = original.to.time - totalTimeMins;
								admin.database().ref(rideTimeRef).set({
									scheduleref: {
										schedyear: event.params.year,
										schedmonth: event.params.month,
										schedday: event.params.day,
										daytime: original.to.daytime
									},
									pending:[
										{
											uid: event.params.userID,
											firstname: locationData.firstname,
											lat: locationData.lat,
											lng: locationData.lng,
											meettime: leaveTime,
											normtimetodeliver: totalTimeMins,
											normdisttodeliver: totalDist,
											fare: locationData.fare
										}
									]
								});
							}
						}
						toRidesRunCount += 1;
						}
					});






					/* 
					//	************************
					//	LOOK AT "FROM" DATA
					//	******** FROM **********
					//	************************
					*/

					// look at rides/<biz_uid>/from/<time> for .exists()
					const fromRideTimeRef = '/rides/' + locationData.businessuid + '/' + locationData.businesslocationid + '/from/' + original.from.time;

					var fromRidesRunCount = 0;
					admin.database().ref(fromRideTimeRef).once('value').then(function(snapshotRides) {
						/* 
						//	
						//	LOOK AT 'FROM' RIDE DATA UNDER RIDES/<BIZ_UID>/<LOC_ID>/FROM/<FROM_TIME>
						//	FROM
						//
						*/


						if (fromRidesRunCount == 0) {
						const rideTimeExists = snapshotRides.exists();
						if (locationData.isdriver == true) {
							/* 
							//	
							//	USER TRIGGERING FUNCTION IS DRIVER
							//	FROM / DRIVER
							//
							*/

							
							console.log("user is driver -- from");
							
							

							if (rideTimeExists == true) {
								/* 
								//	
								//	DATA EXISTS UNDER RIDE TIME REF
								//	FROM / DRIVER / RIDE TIMES EXIST
								//
								*/

								console.log('rides exist with time = ' + original.from.time);

								
								const arriveTime = original.from.time + totalTimeMins;
								const arriveDayTime = original.from.daytime + totalTimeMins;

								let newRideKey = admin.database().ref(fromRideTimeRef).push().key;
								admin.database().ref(fromRideTimeRef + '/queue/' + newRideKey).set({
									driveruid: event.params.userID,
									driverfirstname: locationData.firstname,
									driverlat: locationData.lat,
									driverlng: locationData.lng,
									drivernormtime: totalTimeMins,
									drivernormdist: totalDist,
									leavetime: original.from.time,
									leavedaytime: original.from.daytime,
									arrivetime: arriveTime,
									arrivedaytime: arriveDayTime,
									totalseats: locationData.seats
								});

								// check if pending riders exist
								var pendingRunCount = 0
								admin.database().ref(fromRideTimeRef + '/pending').once('value').then(function(snapshotPending) {
									if (pendingRunCount == 0) {
									const pendingExists = snapshotPending.exists();

									if (pendingExists == true) {
										/* 
										//	
										//	WAITING RIDER DATA EXISTS IN 'PENDING' UNDER RIDE TIME REF
										//	FROM / DRIVER / RIDE TIMES EXIST / PENDING RIDERS EXIST
										//
										*/


										var pendingData = snapshotPending.val();

										const numberOfSeatsOpen = locationData.seats;
										const driverLocation = {lat:locationData.lat, lng:locationData.lng};

										var remainingRiders = pendingData;
										var lastLocation = driverLocation;
										var selectedRiderUIDs = [];
										while (numberOfSeatsOpen > selectedRiderUIDs.length) {
											if (remainingRiders.length > 0) {

												var minDist = 1000000;
												var selectedUID = "";
												var selectedLocation = lastLocation;
												var spliceAtIndex = 0;

												for (var i = 0; i < remainingRiders.length; i++) {
													const currentRiderLocation = {lat:remainingRiders[i].lat, lng:remainingRiders[i].lng};
													var legLatDiff = lastLocation.lat - currentRiderLocation.lat;
													var legLngDiff = lastLocation.lng - currentRiderLocation.lng;
													var legDist = Math.sqrt((legLatDiff * legLatDiff) + (legLngDiff * legLngDiff));
													if (minDist >= legDist) {
														minDist = legDist;
														selectedUID = remainingRiders[i].uid;
														selectedLocation = currentRiderLocation;
														spliceAtIndex = i;
													}
												}

												selectedRiderUIDs.push(selectedUID);
												lastLocation = selectedLocation;
												remainingRiders.splice(spliceAtIndex, 1);

											} else { break; }
										}

										pendingData = snapshotPending.val();

										admin.database().ref('/users/schedule/' + event.params.userID + '/' + event.params.year + '/' + event.params.month + '/' + event.params.day + '/from').set({
											id: newRideKey,
											ismatched: true,
											time: original.from.time,
											daytime: original.from.daytime
										});

										var ridersData = [];
										var riderLocations = [];
										
										console.log("pendingData = " + pendingData + ", length = " + pendingData.length);
										for (var i = 0; i < selectedRiderUIDs.length; i++) {
											console.log("yeee i = " + i + ", uid = " + selectedRiderUIDs[i]);

											for (var j = 0; j < pendingData.length; j++) {
												console.log("j = " + j + ", uid = " + pendingData[j].uid);
												if (selectedRiderUIDs[i] == pendingData[j].uid) {
													console.log("its zee match");
													ridersData.push(pendingData[j]);
													var riderLoc = {lat:pendingData[j].lat, lng:pendingData[j].lng};
													riderLocations.push(riderLoc);

													admin.database().ref('/users/schedule/' + selectedRiderUIDs[i] + '/' + event.params.year + '/' + event.params.month + '/' + event.params.day + '/from').set({
														id: newRideKey,
														ismatched: true,
														time: original.from.time,
														daytime: original.from.daytime
													});
												}
											}
										}

										admin.database().ref('/test/c').set({riderLocations:riderLocations, ridersData:ridersData});

										console.log("b");
										var remainingPendingData = pendingData;
										for (var i = 0; i < selectedRiderUIDs.length; i++) {
											for (var j = 0; j < remainingPendingData.length; j++) {
												if (selectedRiderUIDs[i] == remainingPendingData[j].uid) {
													remainingPendingData.splice(j, 1);
												}
											}
										}
										console.log("c");
										admin.database().ref(fromRideTimeRef + '/queue/' + newRideKey + '/riders').set(ridersData);
										admin.database().ref(fromRideTimeRef + '/pending').set(remainingPendingData);
										

										googleMapsClient.directions({
											origin: {lat:locationData.lat, lng:locationData.lng},
											destination: {lat: businessData.lat, lng: businessData.lng},
											mode: 'driving',
											waypoints: riderLocations,
											optimize: true
								        }, function(errB, respB) {
								        	const routeLegsData = respB.json.routes[0].legs;
											const waypointOrder = respB.json.routes[0].waypoint_order;

											admin.database().ref('/test/d').set(respB.json.routes[0]);

											var totalRouteDist = 0;
											var totalRouteTime = 0;
											for (routeIndex in routeLegsData) {
												console.log(newRideKey + " routeIndex: " + routeIndex);
												const currentLegDist = routeLegsData[routeIndex].distance.value;
												const currentLegTime = routeLegsData[routeIndex].duration.value;
												totalRouteDist += currentLegDist;
												totalRouteTime += currentLegTime;
											}

											const newLeaveTime = original.from.time - totalRouteTime;
											admin.database().ref(fromRideTimeRef + '/queue/' + newRideKey + '/leavetime').set(newLeaveTime);

											for (var riderPreIndex = 0; riderPreIndex < waypointOrder.length; riderPreIndex++) {
												console.log(newRideKey + " rider pre index = " + riderPreIndex);
												console.log(newRideKey + " routeLegsData.length = " + routeLegsData.length);
												const lookingAtRiderIndex = waypointOrder[riderPreIndex];
												console.log(newRideKey + " lookingAtRiderIndex = " + lookingAtRiderIndex);

												var currentRiderDist = 0;
												var currentRiderTime = 0;
												for (var someIndex = riderPreIndex + 1; someIndex < routeLegsData.length; someIndex++) {
													console.log("someIndex = " + someIndex);
													const currentLegDist = routeLegsData[someIndex].distance.value;
													const currentLegTime = routeLegsData[someIndex].duration.value;
													currentRiderDist += currentLegDist;
													currentRiderTime += currentLegTime;
												}

												const currentRiderTimeMins = (currentRiderTime - (currentRiderTime % 60)) / 60;
												console.log(newRideKey + " rider " + riderPreIndex + " final dist = " + currentRiderDist);
												console.log(newRideKey + " rider " + riderPreIndex + " final time = " + currentRiderTime);

												admin.database().ref(fromRideTimeRef + '/queue/' + newRideKey + '/riders/' + lookingAtRiderIndex + '/normdisttodeliver').set(currentRiderDist);
												admin.database().ref(fromRideTimeRef + '/queue/' + newRideKey + '/riders/' + lookingAtRiderIndex + '/normtimetodeliver').set(currentRiderTimeMins);
												console.log("finished for rider pre index = " + riderPreIndex);
											}
											console.log("FIN");
								        });

									}

									pendingRunCount += 1;
									}
								});

							} else {
								/* 
								//	
								//	DATA DOES NOT EXIST UNDER RIDE TIME REF
								//	FROM / DRIVER / RIDE TIMES DO NOT EXIST
								//
								*/


								console.log('rides do not exist with time = ' + original.from.time);
								
								const arriveTime = original.from.time + totalTimeMins;
								const arriveDayTime = original.from.daytime + totalTimeMins;

								let newRideKey = admin.database().ref(fromRideTimeRef).push().key;
								admin.database().ref(fromRideTimeRef + '/queue/' + newRideKey).set({
									driveruid: event.params.userID,
									driverfirstname: locationData.firstname,
									driverlat: locationData.lat,
									driverlng: locationData.lng,
									drivernormtime: totalTimeMins,
									drivernormdist: totalDist,
									leavetime: original.from.time,
									leavedaytime: original.from.daytime,
									arrivetime: arriveTime,
									arrivedaytime: arriveDayTime,
									totalseats: locationData.seats
								});

								// set up schedule ref for ride time
								admin.database().ref(fromRideTimeRef + '/scheduleref').set({
									schedyear: event.params.year,
									schedmonth: event.params.month,
									schedday: event.params.day,
									daytime: original.from.daytime
								});
								
								admin.database().ref('/users/schedule/' + event.params.userID + '/' + event.params.year + '/' + event.params.month + '/' + event.params.day + '/from/id').set(newRideKey);

							}
						} else {
							/* 
							//	
							//	USER TRIGGERING FUNCTION IS RIDER
							//	FROM / RIDER
							//
							*/


							console.log("user is rider");


							if (rideTimeExists == true) {
								/* 
								//	
								//	DATA EXISTS UNDER RIDE TIME REF
								//	FROM / RIDER / RIDE TIMES EXIST
								//
								*/

								console.log("ride times exist")


								var queueRunCount = 0
								admin.database().ref(fromRideTimeRef + '/queue').once('value').then(function(snapshotQueue) {
									if (queueRunCount == 0) {
									queueRunCount += 1;
									const queueExists = snapshotQueue.exists();

									if (queueExists == true) {
										
										const queueData = snapshotQueue.val();

										console.log("queue exists. Data: " + queueData);

										var routeRatings = [];
										var routeKeys = [];
										var routeData = [];
										var routeTotalTime = [];

										var timesThroughQueueData = 0;
										var maxIndexOfQueueData = 0;
										for (var key in queueData) {
											maxIndexOfQueueData += 1;
										}
										maxIndexOfQueueData -= 1;

										console.log("maxIndexOfQueueData = " + maxIndexOfQueueData);
										
										var keys = [];
										var indecies = [];
										var originLocs = [];
										var currentIndex = 0;

										var userNormTimes = [];
										var userNormDists = [];
										var userOrigins = [];

										for (var key in queueData) {
											console.log("queue key: " + key);
											if (queueData.hasOwnProperty(key)) {
										    	//console.log(key + " -> " + queueData[key]);


										    	var tempUserNormTimes = [];
										    	var tempUserNormDists = [];
										    	var tempUserOrigins = [];

										    	// add current user norm info to arrays
										    	tempUserNormTimes.push(totalTimeMins);
										    	tempUserNormDists.push(totalDist);
										    	tempUserOrigins.push({lat: locationData.lat, lng: locationData.lng});

										    	const riderData = queueData[key].riders;

										    	if (riderData != null) {
										    		console.log(key + " rider data exists");
										    		for (var i in riderData) {
										    			tempUserNormTimes.push(queueData[key].riders[i].normtimetodeliver);
										    			tempUserNormDists.push(queueData[key].riders[i].normdisttodeliver);
										    			tempUserOrigins.push({lat: queueData[key].riders[i].lat, lng: queueData[key].riders[i].lng});
										    		}
										    	} else {
										    		console.log(key + " no rider data exists");
										    	}

												console.log(key + " user norm times: " + tempUserNormTimes);
												console.log(key + " user norm dists: " + tempUserNormDists);
												console.log(key + " user origins: " + tempUserOrigins);
												console.log(key + " loc data: lat = " + queueData[key].driverlat + ", lng = " + queueData[key].driverlng);

												userNormTimes.push(tempUserNormTimes);
												userNormDists.push(tempUserNormDists);
												userOrigins.push(tempUserOrigins);

												keys.push(key);
												originLocs.push({lat: queueData[key].driverlat, lng: queueData[key].driverlng});

												indecies.push(currentIndex);
												currentIndex += 1;

										    	googleMapsClient.directions({
													origin: {lat: queueData[key].driverlat, lng: queueData[key].driverlng},
													destination: {lat: businessData.lat, lng: businessData.lng},
													mode: 'driving',
													waypoints: tempUserOrigins,
													optimize: true
										        }, function(errB, respB) {
										        	console.log()
										        	
										        	console.log("here bruhhh");
										        	const testRouteLegsData = respB.json.routes[0].legs;
													const waypointOrder = respB.json.routes[0].waypoint_order;
													console.log("waypointOrder = " + waypointOrder);
													// get current key cause it's fuckin asynch. :'(
										        	var currentKey = "";
										        	var currentDataIndex = 0;

										        	console.log("start loc = lat:" + testRouteLegsData[0].start_location.lat); //+ ", lng:" + testRouteLegsData[0].start_location.lng);
										        	var minCummulativeDiff = 100000;
										        	for (var i = 0; i < originLocs.length; i++) {
										        		//console.log("i = " + i);
										        		const newLatDiff = testRouteLegsData[0].start_location.lat - originLocs[i].lat;
										        		//console.log("newLatDiff = " + newLatDiff);
										        		const newLngDiff = testRouteLegsData[0].start_location.lng - originLocs[i].lng;
										        		//console.log("newLngDiff = " + newLngDiff);
										        		const cummulativeDiff = Math.abs(newLatDiff) + Math.abs(newLngDiff);
										        		//console.log("looping with i = " + i + " of originLocs.length. cummulativeDiff = " + cummulativeDiff);
										        		if (cummulativeDiff <= minCummulativeDiff) {
										        			console.log("new min diff = " + cummulativeDiff);
										        			minCummulativeDiff = cummulativeDiff;
										        			currentKey = keys[i];
										        			currentDataIndex = indecies[i];
										        		}
										        	}

										        	console.log("current key = " + currentKey);
										        	console.log("current data index = " + currentDataIndex);
										        	console.log("userNormTimes[" + currentDataIndex + "] = " + userNormTimes[currentDataIndex]);

										        	

										        	
										        	//console.log(key + " error = " + errB);
													
													console.log(currentKey + " testRouteLegsData: " + testRouteLegsData);
													console.log(currentKey + " waypoint order: " + waypointOrder);
													var riderRatings = [];

													var totalRouteDist = 0;
													var totalRouteTime = 0;
													for (testRouteIndex in testRouteLegsData) {
														console.log(currentKey + " testRouteIndex: " + testRouteIndex);
														const currentLegDist = testRouteLegsData[testRouteIndex].distance.value;
														const currentLegTime = testRouteLegsData[testRouteIndex].duration.value;
														totalRouteDist += currentLegDist;
														totalRouteTime += currentLegTime;
													}

													// add driver rating to riderRatings[]
													const driverRating = getRiderRating(queueData[currentKey].drivernormtime, queueData[currentKey].drivernormdist, totalRouteTime, totalRouteDist);
													riderRatings.push(driverRating);
													console.log(currentKey + ' driver rating: ' + driverRating);

													// calculate rider ratings
													for (var riderPreIndex = 0; riderPreIndex < waypointOrder.length; riderPreIndex++) {
														console.log(currentKey + " rider pre index = " + riderPreIndex);
														console.log(currentKey + " testRouteLegsData.length = " + testRouteLegsData.length);
														const lookingAtRiderIndex = waypointOrder[riderPreIndex];

														const currentRiderNormDist = userNormDists[currentDataIndex][lookingAtRiderIndex];
														const currentRiderNormTime = userNormTimes[currentDataIndex][lookingAtRiderIndex];

														var currentRiderDist = 0;
														var currentRiderTime = 0;
														console.log(currentKey + " rider " + riderPreIndex + " norm dist = " + currentRiderNormDist);
														console.log(currentKey + " rider " + riderPreIndex + " norm time = " + currentRiderNormTime);

														for (var someIndex = riderPreIndex + 1; someIndex < testRouteLegsData.length; someIndex++) {
															const currentLegDist = testRouteLegsData[someIndex].distance.value;
															const currentLegTime = testRouteLegsData[someIndex].duration.value / 60;
															//console.log("leg " + someIndex + " dist = " + currentLegDist + ", leg " + someIndex + " time = " + currentLegTime);

															currentRiderDist += currentLegDist;
															currentRiderTime += currentLegTime;
														}


														console.log(currentKey + " rider " + riderPreIndex + " final dist = " + currentRiderDist);
														console.log(currentKey + " rider " + riderPreIndex + " final time = " + currentRiderTime);

														const riderRating = getRiderRating(currentRiderNormTime, currentRiderNormDist, currentRiderTime, currentRiderDist);
														riderRatings.push(riderRating);
														console.log(currentKey + " rider " + riderPreIndex + " rating: " + riderRating);
													}
													console.log(currentKey + " riderRatings = " + riderRatings);
													console.log(currentKey + " rider rating length = " + riderRatings.length);
													// calculate final route rating
													var finalRating = driverRating;
													for (var riderIndex = 0; riderIndex < riderRatings.length; riderIndex++) { 
														finalRating += riderRatings[riderIndex];
													} 
													finalRating /= riderRatings.length + 1;
													console.log(currentKey + " finalRating = " + finalRating);
													routeRatings.push(finalRating);
													routeKeys.push(currentKey);
													routeData.push(respB.json.routes[0]);
													routeTotalTime.push(totalRouteTime);
													
													if (timesThroughQueueData == maxIndexOfQueueData) {
														console.log("finished rating routes.")
														console.log("finished rating routes with max index = " + maxIndexOfQueueData);
														console.log("routeRatings = " + routeRatings);
														var maxRatingIndex = 0;
														var maxRating = 0;
														for (var ratingIndex = 0; ratingIndex < routeRatings.length; ratingIndex++) {
															console.log("rating index in for loop = " + ratingIndex);
															if (routeRatings[ratingIndex] > maxRating) {
																maxRating = routeRatings[ratingIndex];
																maxRatingIndex = ratingIndex;
															}
														}
														console.log("max rating index = " + maxRatingIndex);

														

														const maxRatingKey = routeKeys[maxRatingIndex];
														const chosenRouteRouteData = routeData[maxRatingIndex];
														const chosenRouteInfoData = queueData[maxRatingKey];
														const chosenRouteTotalTime = routeTotalTime[maxRatingIndex];
														

														console.log("max rating = " + maxRating);
														console.log("max rating key = " + maxRatingKey);
														console.log("queueData[" + maxRatingKey +"] = " + queueData[maxRatingKey]);
														const currentRouteRiderData = chosenRouteInfoData.riders;
														var currentNumberOfRiders = 0;
														if (currentRouteRiderData != null) {
															currentNumberOfRiders = chosenRouteInfoData.riders.length;
														}
														
														console.log("number of riders = " + currentNumberOfRiders);

														console.log("b");

														// change leave time
														const rideRef = '/rides/' + locationData.businessuid + '/' + locationData.businesslocationid + '/from/' + original.from.time + '/queue/' + maxRatingKey;
														const chosenRouteTotalTimeMins = (chosenRouteTotalTime - (chosenRouteTotalTime % 60)) / 60;
														console.log("chosenRouteTotalTime = " + chosenRouteTotalTime + ", chosenRouteTotalTimeMins = " + chosenRouteTotalTimeMins + ", original.from.time = " + original.from.time);
														const leaveTime = original.from.time - chosenRouteTotalTimeMins;
														admin.database().ref(rideRef + '/leavetime').set(leaveTime);

														// change pickup times for riders
														const chosenRouteWaypointOrder = chosenRouteRouteData.waypoint_order;
														console.log("waypoint order = " + chosenRouteWaypointOrder);
														var accumulatedTime = 0;
														var currentUserMeetTime = 0;
														for (var i = 0; i < chosenRouteWaypointOrder.length; i++) {
															console.log("loopin...");
															const currentWaypoint = chosenRouteWaypointOrder[i];
															console.log("i = " + i + ", current waypoint = " + currentWaypoint);
															const waypointLegTime = chosenRouteRouteData.legs[i].duration.value;
															console.log("waypoint leg time = " + waypointLegTime);
															const waypointLegTimeMins = (waypointLegTime - (waypointLegTime % 60)) / 60;

															accumulatedTime += waypointLegTimeMins;
															const currentMeetTime = leaveTime + accumulatedTime;
															console.log("leaveTime = " + leaveTime);
															if (currentWaypoint == 0) {
																console.log("current user waypoint");
																currentUserMeetTime = currentMeetTime;
															} else {
																console.log("waypoint with index = " + currentWaypoint);
																admin.database().ref(rideRef + '/riders/' + (currentWaypoint - 1) + '/meettime').set(currentMeetTime);
															}
														}


														// add current user to riders[]
														admin.database().ref(rideRef + '/riders/' + currentNumberOfRiders).set({
															lat: locationData.lat,
															lng: locationData.lng,
															firstname: locationData.firstname,
															meettime: currentUserMeetTime,
															normdisttodeliver: totalDist,
															normtimetodeliver: totalTimeMins,
															uid: event.params.userID,
															fare: locationData.fare
														});


														// change id and ismatched in schedule ref
														admin.database().ref('/users/schedule/' + event.params.userID + '/' + event.params.year + '/' + event.params.month + '/' + event.params.day + '/from').set({
															id: maxRatingKey,
															ismatched: true,
															time: original.from.time,
															daytime: original.from.daytime
														});


														// check if vehicle is now full
														const newNumberOfRiders = currentNumberOfRiders + 1;
														console.log("newNumberOfRiders = " + newNumberOfRiders);
														if (newNumberOfRiders >= chosenRouteInfoData.totalseats) {
															// vehicle is full - move data to ../rides/full
															console.log("vehicle is full.");
															var timesThroughChosenRoute = 0;
															admin.database().ref(fromRideTimeRef + '/queue/' + maxRatingKey).once('value').then(function(snapshotChosenRoute) {

																if (timesThroughChosenRoute == 0) {
																	timesThroughChosenRoute += 1;

																	const chosenRouteData = snapshotChosenRoute.val();
																	admin.database().ref(fromRideTimeRef + '/full/' + maxRatingKey).set(chosenRouteData);
																	admin.database().ref(fromRideTimeRef + '/queue/' + maxRatingKey).remove();
																	console.log("FIN");
																}
															});
														}

													}
													timesThroughQueueData += 1;
										        });

										    }
										}


									} else {
										console.log("queue does not exist");
									}

									
									}
								});
							} else {
								/* 
								//	
								//	NO PREVIOUS ENTRIES EXIST UNDER GIVEN RIDE TIME
								//	FROM / RIDER / RIDE TIMES DO NOT EXIST
								//
								*/

								console.log("ride times do not exist");



								// set up schedule ref for ride time
								admin.database().ref(fromRideTimeRef).set({
									scheduleref: {
										schedyear: event.params.year,
										schedmonth: event.params.month,
										schedday: event.params.day,
										daytime: original.from.daytime
									},
									pending:[
										{
											uid: event.params.userID,
											firstname: locationData.firstname,
											lat: locationData.lat,
											lng: locationData.lng,
											meettime: original.from.time,
											normtimetodeliver: totalTimeMins,
											normdisttodeliver: totalDist,
											fare: locationData.fare
										}
									]
								});
							}
						}
						fromRidesRunCount += 1;
						}
					});
					
		        });
				}
			});
			locRunCount += 1;
			}
		});
	}
});



function getRiderRating(normTime, normDist, finalTime, finalDist) {
	var timeRating = 0;
	var distRating = 0;

	// rate time
	var maxTime = 2 * normTime;
	if (finalTime >= maxTime) {
		timeRating = 0;
	} else if (finalTime < normTime) {
		timeRating = 1;
	} else {
		timeRating = 2 - (finalTime / normTime);
	}

	// rate dist
	var maxDist = 2 * normDist;
	if (finalDist >= maxDist) {
		distRating = 0;
	} else if (finalDist < normDist) {
		distRating = 1;
	} else {
		distRating = 2 - (finalDist / normDist);
	}

	// cummulative rating
	const finalRating = (timeRating + distRating) / 2;
	console.log("norm time: " + normTime + ", norm dist: " + normDist + ", final time: " + finalTime + ", finalDist: " + finalDist + ".");
	console.log("time rating: " + timeRating + ", distRating: " + distRating);
	return finalRating;
}

function getDistanceFromLatLonInKm(lat1,lon1,lat2,lon2) {
  var R = 6371; // Radius of the earth in km
  var dLat = deg2rad(lat2-lat1);  // deg2rad below
  var dLon = deg2rad(lon2-lon1); 
  var a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * 
    Math.sin(dLon/2) * Math.sin(dLon/2)
    ; 
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  var d = R * c; // Distance in km
  return d;
}

function deg2rad(deg) {
  return deg * (Math.PI/180)
}




