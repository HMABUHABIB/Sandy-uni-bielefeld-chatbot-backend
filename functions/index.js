'use strict';

const functions = require('firebase-functions');
const { WebhookClient } = require('dialogflow-fulfillment');
const { Card, Suggestion } = require('dialogflow-fulfillment');
const { Payload } = require('dialogflow-fulfillment');
const moment = require('moment');
const axios = require('axios');
const requestLib = require('request');
let fs = require('fs-extra');
const createHafas = require('db-hafas');
const hafas = createHafas('my-awesome-program');
let DomParser = require('dom-parser');
let format = require('xml-formatter');
const nodeMailer = require('nodemailer');

require('dotenv').config();



const createClient = require('hafas-client');
const vbbProfile = require('hafas-client/p/vbb');
const client = createClient(vbbProfile, 'my-awesome-program');

let admin = require("firebase-admin");
admin.initializeApp(process.env.firebaseConfig);


// Get google place from id for that place
function getGooglePlaceFromID(place_id) {
  return axios.get('https://maps.googleapis.com/maps/api/place/details/json?place_id=' + place_id + '&fields=opening_hours/weekday_text,opening_hours,formatted_address,name,rating,formatted_phone_number&key=****');
}

// Get Train and Bus data from transport.rest
function getTimetable() {
  return axios.get('https://2.db.transport.rest/stations/927743/departures?duration=120');
}

// Get mensa menu from openmensa.org
function getStudierendenWerkInfo() {
  return axios.get(`https://openmensa.org/api/v2/canteens/203/days/${moment().format('YYYY-MM-DD')}/meals`);
}


process.env.DEBUG = 'dialogflow:debug'; // enables lib debugging statements


// Main Dialogflow Function
exports.dialogflowFirebaseFulfillment = functions.https.onRequest((request, response) => {

  const agent = new WebhookClient({ request, response });

  // Send message to slack
  function sendSlackMessage(time, sessionId, messageText) {
    let slackMessageBody = {
      "username": "Husam",
      "text": "Time:" + time + "Session ID" + sessionId + "Text:" + messageText,
      "icon_emoji": ":tada:"
    };

    // Post the message above to slack
    requestLib.post({
      headers: { 'content-type': 'application/json' },
      url: "https://hooks.slack.com/services/****",
      body: JSON.stringify(slackMessageBody)
    }, function (error, response, body) {
      console.log('Slack notification response body: ' + JSON.stringify(body) + ', error: ' + error);
    });



  }

  // Post data to google sheet to be saved there
  function saveInGoogleSheetsFunktion(time, session, questionText) {
    const data = [
      {
        Time: time, SessionId: session, Question: questionText
      }
    ];
    axios.post('https://sheet.best/api/sheets/fff866ef-77aa-4631-a957-9aa722328a11', data);
  }

  // Sandy fallback function
  function fallback(agent) {
    let sessionId = agent.session.substring(42);
    let Time = moment().format("YYYY/MM/DD h:mm A");
    let messageText = JSON.stringify(agent.request_.body.queryResult.queryText);
    agent.add("Thank you so much for bringing this into my attention. At the moment,I am unable to answer this question, but I will find the related information and will be updated ASAP.");
    sendSlackMessage(Time, sessionId, messageText);
    saveInGoogleSheetsFunktion(Time, sessionId, messageText);

    agent.add(new Payload("PLATFORM_UNSPECIFIED", [{
      "message": `Shall I forward your message to one of my colleagues 👩🏽‍💻??`,
      "platform": "kommunicate",
      "metadata": {
        "contentType": "300",
        "templateId": "6",
        "payload": [{
          "title": "Yes",
          "message": "Yes"
        }, {
          "title": "No",
          "message": "No,Thank you",
          "replyMetadata": {
            "KM_CHAT_CONTEXT": {
              "buttonClicked": true
            }
          }
        }]
      }
    }

    ]));

  }

  // follow up fallback after getting the email address from the user
  function fallback_Email(agent) {
    let sessionId = agent.session.substring(42);
    let Time = moment().format("YYYY/MM/DD h:mm A");
    let messageText = JSON.stringify(agent.request_.body.queryResult.queryText);
    sendSlackMessage(Time, sessionId, messageText);
    saveInGoogleSheetsFunktion(Time, sessionId, messageText);
    agent.add(`One of my colleagues will contact you soon.\nCan I assist you with anything further?`);

  }

  // The first fallback message will come to the user
  function fallback_main(agent) {
    let sessionId = agent.session.substring(42);
    let Time = moment().format("YYYY/MM/DD h:mm A");
    let messageText = JSON.stringify(agent.request_.body.queryResult.queryText);
    sendSlackMessage(Time, sessionId, messageText);
    saveInGoogleSheetsFunktion(Time, sessionId, messageText);
    let fallback_Text = [
      "I'm not sure I understood. Try asking another way?",
      "Can you try asking it a different way?",
      "Sorry, I didn't get that. Can you rephrase?",
      "I didn't get that. Can you rephrase it again?"
    ];
    agent.add(fallback_Text[Math.floor(Math.random() * (4 - 0) + 0)]);
  }

  // Get the info about the time for the places in Google or read the info from nonGooglePlaceData json file
  function timeAndPlaceFunktion(agent) {
    try {
      const place_id = agent.parameters.google_place_ID;
      const place_name = agent.parameters.google_place_name;
      const non_google_place = agent.parameters.non_google_place;
      const non_google_place_name = agent.parameters.non_google_place_name;

      // Get the data from Google maps
      if (place_id != '0') {
        return getGooglePlaceFromID(place_id).then(res => {
          const opening_hours = res.data.result.opening_hours;
          const address = res.data.result.formatted_address;
          const open = JSON.stringify(opening_hours.open_now);
          let message = `${place_name}`;
          if (open == 'true') { message += " is open now.\nThe Opening Time:"; }
          if (open == 'false') { message += " is closed now.\nThe Opening Time:"; }
          for (let step = 0; step < opening_hours.weekday_text.length; step++) {
            message += `\n${opening_hours.weekday_text[step]}`;
          }
          message += `\nThe address is:${address}`;
          agent.add(message);
        });

        // Get the data from nonGooglePlaceData.json file
      } else if (non_google_place != 0) {
        const nonGooglePlaceObj = fs.readJsonSync('./nonGooglePlaceData.json');
        for (let step = 0; step < nonGooglePlaceObj.length; step++) {
          if (non_google_place == nonGooglePlaceObj[step].name) {
            agent.add(`${nonGooglePlaceObj[step].Text}\n${nonGooglePlaceObj[step].name}\nMonday: ${nonGooglePlaceObj[step].Monday}\nTuesday: ${nonGooglePlaceObj[step].Tuesday}\nWednesday: ${nonGooglePlaceObj[step].Wednesday}\nThursday: ${nonGooglePlaceObj[step].Thursday}\nFriday: ${nonGooglePlaceObj[step].Friday}\nSaturday: ${nonGooglePlaceObj[step].Saturday}\nSunday: ${nonGooglePlaceObj[step].Sunday}\nFor info:${nonGooglePlaceObj[step].Address}\n${nonGooglePlaceObj[step].Details}`);
          }
        }

      } else {
        agent.add("Sorry i can't find the opening time in my database I will look it up soon");
      }

    } catch (e) {
      console.log(e);
      agent.add("Sorry can you try again");
    }

  }

  async function mensaMenuFunktion(agent) {
    let Text = '';
    return getStudierendenWerkInfo().then(res => {

      Text += `🌱${res.data[0].category} 🌱\n${res.data[0].name.bold()}\n${res.data[0].notes}\n\n`;
      Text += `🌟 ${res.data[1].category} 🌟\n${res.data[1].name.bold()}\n${res.data[1].notes}\n\n`;
      Text += `🏋 ${res.data[2].category} 🏋\n${res.data[2].name.bold()}\n${res.data[2].notes}\n\n`;
      Text += `🍲 ${res.data[3].category} 🍲\n${res.data[3].name.bold()}\n${res.data[3].notes}`;
      Text += `\n${res.data[4].name.bold()}\n${res.data[4].notes}\n\n`;
      Text += `😋 Enjoy your meal😀\n\n`;

      agent.add(new Payload("PLATFORM_UNSPECIFIED", [{
        "message": Text + "❗Please see the link below for more information❗",
        "platform": "kommunicate",
        "metadata": {
          "contentType": "300",
          "templateId": "3",
          "payload": [
            {
              "type": "link",
              "url": "http://www.studierendenwerk-bielefeld.de/en.html",
              "name": "Mensa menu"
            },
            {
              "type": "link",
              "url": "http://www.studierendenwerk-bielefeld.de/en/campus-catering/daily-meals-in-canteens-and-cafeterias/bielefeld/cafeteria-building-x.html",
              "name": "Cafeteria x-building  menu"
            },
            {
              "type": "link",
              "url": "http://www.studierendenwerk-bielefeld.de/en/campus-catering/daily-meals-in-canteens-and-cafeterias/bielefeld/university-main-building-westend-cafeteria.html",
              "name": "Westend-Cafeteria menu"
            }
          ]
        }
      }


      ]));

    }).catch((e) => {
      agent.add(new Payload("PLATFORM_UNSPECIFIED", [{
        "message": "Sorry I cant provide you with menu today\n@For More Information:",
        "platform": "kommunicate",
        "metadata": {
          "contentType": "300",
          "templateId": "3",
          "payload": [
            {
              "type": "link",
              "url": "http://www.studierendenwerk-bielefeld.de/en.html",
              "name": "Mensa menu"
            },
            {
              "type": "link",
              "url": "http://www.studierendenwerk-bielefeld.de/en/campus-catering/daily-meals-in-canteens-and-cafeterias/bielefeld/cafeteria-building-x.html",
              "name": "Cafeteria x-building  menu"
            },
            {
              "type": "link",
              "url": "http://www.studierendenwerk-bielefeld.de/en/campus-catering/daily-meals-in-canteens-and-cafeterias/bielefeld/university-main-building-westend-cafeteria.html",
              "name": "Westend-Cafeteria menu"
            }
          ]
        }
      }


      ]));
    })




  }

  async function hochschulSportFunktion(agent) {
    let Hochschulsport = agent.parameters.SportName;
    let Text = '';

    if (Hochschulsport != 0) {
      const sportObj = fs.readJsonSync('./sport.json');
      for (let step = 0; step < sportObj.length; step++) {
        if (Hochschulsport == sportObj[step].Sport) {
          Text += `${Hochschulsport.bold()}\nWhen:${sportObj[step].Day} \nAt ${sportObj[step].Time}\nWhere:${sportObj[step].Place}\nLevel:${sportObj[step].Level}\nDate:${sportObj[step].Date}\nCost:${sportObj[step].Cost}\n\n`;

        }
      }

      // kommunicate web UI
      agent.add(new Payload("PLATFORM_UNSPECIFIED", [{
        "message": `${Text}Would you like to search for other sport?`,
        "platform": "kommunicate",
        "metadata": {
          "contentType": "300",
          "templateId": "6",
          "payload": [{
            "title": "Yes",
            "message": "Show me sports program"
          }, {
            "title": "No",
            "message": "No,Thanks",
            "replyMetadata": {
              "KM_CHAT_CONTEXT": {
                "buttonClicked": true
              }
            }
          }]
        }
      }


      ]));

    } else {
      // kommunicate web UI
      agent.add(new Payload("PLATFORM_UNSPECIFIED", [{
        "message": "Sorry i can't find this sport  in my database I will look it up soon.",
        "platform": "kommunicate",
        "metadata": {
          "contentType": "300",
          "templateId": "3",
          "payload": [
            {
              "type": "link",
              "url": "https://www.uni-bielefeld.de/Universitaet/Serviceangebot/Sport/sportprogramm/index.html",
              "name": "Hochschulsport website for more info"
            }
          ]
        }
      }


      ]));

    }
  }

  // Get time table for bus and train 
  async function timeTableFunktion(agent) {
    const Refresh = agent.request_.body.queryResult.queryText;
    let timetTable = `\nNow:${moment().add(1, 'hour').format().slice(11, 16)} Date:${moment().add(1, 'hour').format().slice(5, 10)}`;
    let tripNumber = 5;
    return getTimetable().then(res => {
      if (res.data.length != 0) {
        if (res.data.length <= 5) {
          tripNumber = res.data.length;
        }

        for (let step = 0; step < tripNumber; step++) {
          if (res.data[step].stop.name == "Universität, Bielefeld") {
            let direction = res.data[step].direction;
            direction = /(.+),/.exec(direction)[1];
            timetTable += `\n\n${res.data[step].line.id.toLocaleUpperCase().bold()} ${moment(res.data[step].when, "").fromNow()}\nDirection:${direction}\nTime:${res.data[step].when.slice(11, 16)} Date:${res.data[step].when.slice(5, 10)}`;
          }
        }


        // kommunicate web UI
        agent.add(new Payload("PLATFORM_UNSPECIFIED", [{
          "message": `Tram and Bus Timetable From Universität Station.${timetTable}`,
          "platform": "kommunicate",
          "metadata": {
            "contentType": "300",
            "templateId": "6",
            "payload": [{
              "title": "Refresh",
              "message": Refresh
            }]
          }
        }
        ]));

      } else {

        // kommunicate web UI
        agent.add(new Payload("PLATFORM_UNSPECIFIED", [{
          "message": "Sorry there is no Tram or Bus for the next 2 Hours From Universität Station",
          "platform": "kommunicate",
          "metadata": {
            "contentType": "300",
            "templateId": "3",
            "payload": [{
              "type": "link",
              "url": "https://www.mobiel.de/",
              "name": "Go To mobiel for more info."
            }
            ]
          }
        }
        ]));


      }



    });

  }

  // Send email to the user
  function sendEmail(agent) {
    agent.add("Email is sent");

    let transporter = nodeMailer.createTransport({
      host: 'smtp.uni-bielefeld.de',
      port: 587,
      secure: false,  //true for 465 port, false for other ports
      auth: {
        user: process.env.EMAIL,
        pass: process.env.PASSWORD
      }
    });

    const mailOptions = {
      from: '"Husam" <hmabuhabib@uni-bielefeld.de>', // sender address
      to: agent.parameters.Email, // list of receivers
      subject: 'Sandy fallback', // Subject line
      text: 'Sandy fallback email test', // plain text body
      html: '<b>Sandy fallback email test</b>' // html body
    };
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.log(error);
        res.status(400).send({ success: false })
      } else {
        res.status(200).send({ success: true });
      }
    });

  }





  let intentMap = new Map();

  intentMap.set('Default Fallback Intent', fallback_main);
  intentMap.set('Default Fallback Intent - fallback', fallback);
  intentMap.set('Default Fallback Intent - fallback - yes - custom', fallback_Email);
  intentMap.set('Place opening time', timeAndPlaceFunktion);
  intentMap.set('Hochschulsport_with_sport_name', hochschulSportFunktion);
  intentMap.set('Hochschulsport - custom', hochschulSportFunktion);
  intentMap.set('Timetable Tram and Bus', timeTableFunktion);
  intentMap.set('Mensa Menu', mensaMenuFunktion);
  intentMap.set('SendEmail', sendEmail);


  agent.handleRequest(intentMap);
});
