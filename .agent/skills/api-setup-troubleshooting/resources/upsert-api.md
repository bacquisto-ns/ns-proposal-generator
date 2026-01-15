Upsert Contact
POST
https://services.leadconnectorhq.com/contacts/upsert
Please find the list of acceptable values for the country field here

The Upsert API will adhere to the configuration defined under the “Allow Duplicate Contact” setting at the Location level. If the setting is configured to check both Email and Phone, the API will attempt to identify an existing contact based on the priority sequence specified in the setting, and will create or update the contact accordingly.

If two separate contacts already exist—one with the same email and another with the same phone—and an upsert request includes both the email and phone, the API will update the contact that matches the first field in the configured sequence, and ignore the second field to prevent duplication.

Requirements
Scope(s)
contacts.write
Auth Method(s)
OAuth Access Token
Private Integration Token
Token Type(s)
Sub-Account Token
Request
Header Parameters
Version
string
required
Possible values: [2021-07-28]

API Version

application/json
Bodyrequired
firstName
string
nullable
Example:Rosan
lastName
string
nullable
Example:Deo
name
string
nullable
Example:Rosan Deo
email
string
nullable
Example:rosan@deos.com
locationId
string
required
Example:ve9EPM428h8vShlRW1KT
gender
string
Example:male
phone
string
nullable
Example:+1 888-888-8888
address1
string
nullable
Example:3535 1st St N
city
string
nullable
Example:Dolomite
state
string
nullable
Example:AL
postalCode
string
Example:35061
website
string
nullable
Example:https://www.tesla.com
timezone
string
nullable
Example:America/Chihuahua
dnd
boolean
Example:true
dndSettings
object
inboundDndSettings
object
tags
string[]
This field will overwrite all current tags associated with the contact. To update a tags, it is recommended to use the Add Tag or Remove Tag API instead.

Example:["nisi sint commodo amet","consequat"]
customFields
object[]
source
string
Example:public api
dateOfBirth
object
nullable
The birth date of the contact. Supported formats: YYYY/MM/DD, MM/DD/YYYY, YYYY-MM-DD, MM-DD-YYYY, YYYY.MM.DD, MM.DD.YYYY, YYYY_MM_DD, MM_DD_YYYY

Example:1990-09-25
country
string
Example:US
companyName
string
nullable
Example:DGS VolMAX
assignedTo
string
User's Id

Example:y0BeYjuRIlDwsDcOHOJo
createNewIfDuplicateAllowed
boolean
Controls whether to create a new contact or update an existing duplicate. Scenario 1: If this value is true and the location allows duplicate contacts, a new contact will be created immediately without checking for duplicates. Scenario 2: If this value is true but the location does not allow duplicate contacts, this field is ignored and the normal upsert behavior applies: the API will search for an existing duplicate contact, update it if found, or create a new contact if not found. Scenario 3: If this value is false or not provided, the normal upsert behavior applies regardless of the location's duplicate contact setting.

Default value: false
Example:false
Responses
200
400
401
422
Successful response
application/json
Schema
Example (auto)
Schema
new
boolean
Example:true
contact
object
traceId
string
Share your feedback
★
★
★
★
★
Authorization: Authorization
curl
nodejs
python
php
java
go
ruby
powershell
SDK
AXIOS
NATIVE
REQUEST
UNIREST
const { HighLevel } = require('@gohighlevel/api-client');

const highLevel = new HighLevel({
  clientId: 'your_client_id_here',
  clientSecret: 'your_client_secret_here',
});

try {
  const response = await highLevel.contacts.upsertContact({
    'firstName': 'Rosan',
    'lastName': 'Deo',
    'name': 'Rosan Deo',
    'email': 'rosan@deos.com',
    'locationId': 've9EPM428h8vShlRW1KT',
    'gender': 'male',
    'phone': '+1 888-888-8888',
    'address1': '3535 1st St N',
    'city': 'Dolomite',
    'state': 'AL',
    'postalCode': '35061',
    'website': 'https://www.tesla.com',
    'timezone': 'America/Chihuahua',
    'dnd': true,
    'dndSettings': {
      'Call': {
        'status': 'active',
        'message': 'string',
        'code': 'string'
      },
      'Email': {
        'status': 'active',
        'message': 'string',
        'code': 'string'
      },
      'SMS': {
        'status': 'active',
        'message': 'string',
        'code': 'string'
      },
      'WhatsApp': {
        'status': 'active',
        'message': 'string',
        'code': 'string'
      },
      'GMB': {
        'status': 'active',
        'message': 'string',
        'code': 'string'
      },
      'FB': {
        'status': 'active',
        'message': 'string',
        'code': 'string'
      }
    },
    'inboundDndSettings': {
      'all': {
        'status': 'active',
        'message': 'string'
      }
    },
    'tags': [
      'nisi sint commodo amet',
      'consequat'
    ],
    'customFields': [
      {
        'id': '6dvNaf7VhkQ9snc5vnjJ',
        'key': 'my_custom_field',
        'field_value': 'My Text'
      },
      {
        'id': '6dvNaf7VhkQ9snc5vnjJ',
        'key': 'my_custom_field',
        'field_value': 'My Text'
      },
      {
        'id': '6dvNaf7VhkQ9snc5vnjJ',
        'key': 'my_custom_field',
        'field_value': 'My Selected Option'
      },
      {
        'id': '6dvNaf7VhkQ9snc5vnjJ',
        'key': 'my_custom_field',
        'field_value': 'My Selected Option'
      },
      {
        'id': '6dvNaf7VhkQ9snc5vnjJ',
        'key': 'my_custom_field',
        'field_value': 100
      },
      {
        'id': '6dvNaf7VhkQ9snc5vnjJ',
        'key': 'my_custom_field',
        'field_value': 100.5
      },
      {
        'id': '6dvNaf7VhkQ9snc5vnjJ',
        'key': 'my_custom_field',
        'field_value': [
          'test',
          'test2'
        ]
      },
      {
        'id': '6dvNaf7VhkQ9snc5vnjJ',
        'key': 'my_custom_field',
        'field_value': [
          'test',
          'test2'
        ]
      },
      {
        'id': '6dvNaf7VhkQ9snc5vnjJ',
        'key': 'my_custom_field',
        'field_value': {
          'f31175d4-2b06-4fc6-b7bc-74cd814c68cb': {
            'meta': {
              'fieldname': '1HeGizb13P0odwgOgKSs',
              'originalname': 'IMG_20231215_164412935.jpg',
              'encoding': '7bit',
              'mimetype': 'image/jpeg',
              'size': 1786611,
              'uuid': 'f31175d4-2b06-4fc6-b7bc-74cd814c68cb'
            },
            'url': 'https://services.leadconnectorhq.com/documents/download/w2M9qTZ0ZJz8rGt02jdJ',
            'documentId': 'w2M9qTZ0ZJz8rGt02jdJ'
          }
        }
      }
    ],
    'source': 'public api',
    'dateOfBirth': '1990-09-25',
    'country': 'US',
    'companyName': 'DGS VolMAX',
    'assignedTo': 'y0BeYjuRIlDwsDcOHOJo',
    'createNewIfDuplicateAllowed': false
  });
  console.log(response);
} catch (error) {
  console.error('Error:', error);
}


Request
Collapse all
Base URL
https://services.leadconnectorhq.com
Auth
Bearer Token
Bearer Token
Parameters
Version — headerrequired

---
Body
 required
{
  "firstName": "Rosan",
  "lastName": "Deo",
  "name": "Rosan Deo",
  "email": "rosan@deos.com",
  "locationId": "ve9EPM428h8vShlRW1KT",
  "gender": "male",
  "phone": "+1 888-888-8888",
  "address1": "3535 1st St N",
  "city": "Dolomite",
  "state": "AL",
  "postalCode": "35061",
  "website": "https://www.tesla.com",
  "timezone": "America/Chihuahua",
  "dnd": true,
  "dndSettings": {
    "Call": {
      "status": "active",
      "message": "string",
      "code": "string"
    },
    "Email": {
      "status": "active",
      "message": "string",
      "code": "string"
    },
    "SMS": {
      "status": "active",
      "message": "string",
      "code": "string"
    },
    "WhatsApp": {
      "status": "active",
      "message": "string",
      "code": "string"
    },
    "GMB": {
      "status": "active",
      "message": "string",
      "code": "string"
    },
    "FB": {
      "status": "active",
      "message": "string",
      "code": "string"
    }
  },
  "inboundDndSettings": {
    "all": {
      "status": "active",
      "message": "string"
    }
  },
  "tags": [
    "nisi sint commodo amet",
    "consequat"
  ],
  "customFields": [
    {
      "id": "6dvNaf7VhkQ9snc5vnjJ",
      "key": "my_custom_field",
      "field_value": "My Text"
    },
    {
      "id": "6dvNaf7VhkQ9snc5vnjJ",
      "key": "my_custom_field",
      "field_value": "My Text"
    },
    {
      "id": "6dvNaf7VhkQ9snc5vnjJ",
      "key": "my_custom_field",
      "field_value": "My Selected Option"
    },
    {
      "id": "6dvNaf7VhkQ9snc5vnjJ",
      "key": "my_custom_field",
      "field_value": "My Selected Option"
    },
    {
      "id": "6dvNaf7VhkQ9snc5vnjJ",
      "key": "my_custom_field",
      "field_value": 100
    },
    {
      "id": "6dvNaf7VhkQ9snc5vnjJ",
      "key": "my_custom_field",
      "field_value": 100.5
    },
    {
      "id": "6dvNaf7VhkQ9snc5vnjJ",
      "key": "my_custom_field",
      "field_value": [
        "test",
        "test2"
      ]
    },
    {
      "id": "6dvNaf7VhkQ9snc5vnjJ",
      "key": "my_custom_field",
      "field_value": [
        "test",
        "test2"
      ]
    },
    {
      "id": "6dvNaf7VhkQ9snc5vnjJ",
      "key": "my_custom_field",
      "field_value": {
        "f31175d4-2b06-4fc6-b7bc-74cd814c68cb": {
          "meta": {
            "fieldname": "1HeGizb13P0odwgOgKSs",
            "originalname": "IMG_20231215_164412935.jpg",
            "encoding": "7bit",
            "mimetype": "image/jpeg",
            "size": 1786611,
            "uuid": "f31175d4-2b06-4fc6-b7bc-74cd814c68cb"
          },
          "url": "https://services.leadconnectorhq.com/documents/download/w2M9qTZ0ZJz8rGt02jdJ",
          "documentId": "w2M9qTZ0ZJz8rGt02jdJ"
        }
      }
    }
  ],
  "source": "public api",
  "dateOfBirth": "1990-09-25",
  "country": "US",
  "companyName": "DGS VolMAX",
  "assignedTo": "y0BeYjuRIlDwsDcOHOJo",
  "createNewIfDuplicateAllowed": false
}
Send API Request