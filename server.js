// This loads the environment variables from the .env file
require('dotenv-extended').load();

var builder = require('botbuilder');
var restify = require('restify');
var Store = require('./store');

// disabled in .env
var spellService = require('./spell-service');

// Setup Restify Server
var server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3978, function () {
    console.log('%s listening to %s', server.name, server.url);
});

// connects your bot to the Bot Framework Connector Service
var connector = new builder.ChatConnector({
    appId: process.env.MICROSOFT_APP_ID,
    appPassword: process.env.MICROSOFT_APP_PASSWORD
});

// API endpoint 
server.post('/api/messages', connector.listen());

// UniversalBot class responsible for managing all the conversations your bot has with a user
var bot = new builder.UniversalBot(connector, {
    // dialog waterfall steps
        storage: new builder.MemoryBotStorage(), // to solve "The Bot State API is deprecated."
        function (session) {
            session.send('Sorry, I did not understand \'%s\'. Type \'help\' if you need assistance.', session.message.text);
            session.sendTyping();
        }
    }
);

// You can provide your own model by specifing the 'LUIS_MODEL_URL' environment variable
// This Url can be obtained by uploading or creating your model from the LUIS portal: https://www.luis.ai/
var recognizer = new builder.LuisRecognizer(process.env.LUIS_MODEL_URL);
bot.recognizer(recognizer);

// Send welcome messages when bot conversation is started, by initiating the welcome dialog
bot.on('conversationUpdate', function (message) {
    if (message.membersAdded) {
        message.membersAdded.forEach(function (identity) {
            if (identity.id === message.address.bot.id) {
                bot.beginDialog(message.address, 'welcome');
            }
        });
    }
});

// welcome messages
bot.dialog('welcome', function (session) {

    var currentTime = new Date();
    var currentHour = currentTime.getHours();
    var timeWiseGreetings = '';

    if ( currentHour < 12 )
        timeWiseGreetings = "Good Morning ! ";
    else if ( ( currentHour >= 12 ) && ( currentHour < 18 ) )
        timeWiseGreetings = "Good Afternoon ! ";
    else
        timeWiseGreetings = "Good Evening ! ";

    //can be taken from database
    var messageSuffix = "Welcome to the HKTDC bot. How can I help you?"; 
    var messageSuffix_2 = "I am HKTDC Bot. Let me help you.";
    var messageSuffix_3 = "What would you like to look for?";
    var welcomeMsgs = [messageSuffix, messageSuffix_2, messageSuffix_3];

    var systemGeneratedMessage = welcomeMsgs[Math.round((Math.random() * 3) )];
    
    // Send a typing indicator
    session.sendTyping();
    setTimeout(function () {
        session.send( timeWiseGreetings );
        session.sendTyping();
    }, 2000);

    setTimeout(function () {
        session.send( systemGeneratedMessage );
    }, 5000);

});

// general enquiries FAQs intent
bot.dialog('Hktdc_Overseas_Fairs', function (session) {
    session.sendTyping();
    setTimeout(function () {
        session.endDialog('You can find HKTDC Worldwide Trade Events by clicking [here](http://www.hktdc.com/info/trade-events/ci/TDCWORLD-upcoming/en/HKTDC-Worldwide-Trade-Events.html).');
    }, 2000);
}).triggerAction({
    matches: 'Hktdc_Overseas_Fairs'
});


// none of the intents are matched
bot.dialog('None', function (session) {
    session.sendTyping();
    session.send('Sorry, we can\'t understand. Message is sent to our support team via email. Thank you for your enquiry.');
     setTimeout(function () {
        session.beginDialog('welcome');
    }, 3000); 

}).triggerAction({
    matches: 'None'
});

bot.dialog('SearchHotels', [
    function (session, args, next) {
        session.send('Welcome to the Hotels finder! We are analyzing your message: \'%s\'', session.message.text);

        // try extracting entities
        var cityEntity = builder.EntityRecognizer.findEntity(args.intent.entities, 'builtin.geography.city');
        var airportEntity = builder.EntityRecognizer.findEntity(args.intent.entities, 'AirportCode');
        if (cityEntity) {
            // city entity detected, continue to next step
            session.dialogData.searchType = 'city';
            next({ response: cityEntity.entity });
        } else if (airportEntity) {
            // airport entity detected, continue to next step
            session.dialogData.searchType = 'airport';
            next({ response: airportEntity.entity });
        } else {
            // no entities detected, ask user for a destination
            builder.Prompts.text(session, 'Please enter your destination');
        }
    },
    function (session, results) {
        var destination = results.response;

        var message = 'Looking for hotels';
        if (session.dialogData.searchType === 'airport') {
            message += ' near %s airport...';
        } else {
            message += ' in %s...';
        }

        session.send(message, destination);

        // Async search
        Store
            .searchHotels(destination)
            .then(function (hotels) {
                // args
                session.send('I found %d hotels:', hotels.length);

                var message = new builder.Message()
                    .attachmentLayout(builder.AttachmentLayout.carousel)
                    .attachments(hotels.map(hotelAsAttachment));

                session.send(message);

                // End
                session.endDialog();
            });
    }
]).triggerAction({
    matches: 'SearchHotels',
    onInterrupted: function (session) {
        session.send('Please provide a destination');
    }
});

bot.dialog('ShowHotelsReviews', function (session, args) {
    // retrieve hotel name from matched entities
    var hotelEntity = builder.EntityRecognizer.findEntity(args.intent.entities, 'Hotel');
    if (hotelEntity) {
        session.send('Looking for reviews of \'%s\'...', hotelEntity.entity);
        Store.searchHotelReviews(hotelEntity.entity)
            .then(function (reviews) {
                var message = new builder.Message()
                    .attachmentLayout(builder.AttachmentLayout.carousel)
                    .attachments(reviews.map(reviewAsAttachment));
                session.endDialog(message);
            });
    }
}).triggerAction({
    matches: 'ShowHotelsReviews'
});

bot.dialog('Help', function (session) {
    session.endDialog('Hi! Try asking me things like \'search hotels in Seattle\', \'search hotels near LAX airport\' or \'show me the reviews of The Bot Resort\'');
}).triggerAction({
    matches: 'Help'
});

// Spell Check
if (process.env.IS_SPELL_CORRECTION_ENABLED === 'true') {
    bot.use({
        botbuilder: function (session, next) {
            spellService
                .getCorrectedText(session.message.text)
                .then(function (text) {
                    session.message.text = text;
                    next();
                })
                .catch(function (error) {
                    console.error(error);
                    next();
                });
        }
    });
}

// Helpers
function hotelAsAttachment(hotel) {
    return new builder.HeroCard()
        .title(hotel.name)
        .subtitle('%d stars. %d reviews. From $%d per night.', hotel.rating, hotel.numberOfReviews, hotel.priceStarting)
        .images([new builder.CardImage().url(hotel.image)])
        .buttons([
            new builder.CardAction()
                .title('More details')
                .type('openUrl')
                .value('https://www.bing.com/search?q=hotels+in+' + encodeURIComponent(hotel.location))
        ]);
}

function reviewAsAttachment(review) {
    return new builder.ThumbnailCard()
        .title(review.title)
        .text(review.text)
        .images([new builder.CardImage().url(review.image)]);
}