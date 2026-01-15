Upsert Opportunity
POST
https://services.leadconnectorhq.com/opportunities/upsert
Upsert Opportunity

Requirements
Scope(s)
opportunities.write
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
id
string
opportunityId

Example:yWQobCRIhRguQtD2llvk
pipelineId
string
required
pipeline Id

Example:bCkKGpDsyPP4peuKowkG
locationId
string
required
locationId

Example:CLu7BaljjqrEjBGKTNNe
followers
string[]
required
contactId

Example:LiKJ2vnRg5ETM8Z19K7
isRemoveAllFollowers
boolean
required
isRemoveAllFollowers

Example:true
followersActionType
string
required
followers action type

Possible values: [add, remove]

Example:add
name
string
name

Example:opportunity name
status
string
Possible values: [open, won, lost, abandoned, all]

pipelineStageId
string
Example:7915dedc-8f18-44d5-8bc3-77c04e994a10
monetaryValue
number
Example:220
assignedTo
string
Example:082goXVW3lIExEQPOnd3
lostReasonId
string
lost reason Id

Example:CLu7BaljjqrEjBGKTNNe
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
opportunity
object
required
Updated / New Opportunity

new
boolean
required
Example:true
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
  const response = await highLevel.opportunities.upsertOpportunity({
    'id': 'yWQobCRIhRguQtD2llvk',
    'pipelineId': 'bCkKGpDsyPP4peuKowkG',
    'locationId': 'CLu7BaljjqrEjBGKTNNe',
    'followers': 'LiKJ2vnRg5ETM8Z19K7',
    'isRemoveAllFollowers': true,
    'followersActionType': 'add',
    'name': 'opportunity name',
    'status': 'open',
    'pipelineStageId': '7915dedc-8f18-44d5-8bc3-77c04e994a10',
    'monetaryValue': 220,
    'assignedTo': '082goXVW3lIExEQPOnd3',
    'lostReasonId': 'CLu7BaljjqrEjBGKTNNe'
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
  "id": "yWQobCRIhRguQtD2llvk",
  "pipelineId": "bCkKGpDsyPP4peuKowkG",
  "locationId": "CLu7BaljjqrEjBGKTNNe",
  "followers": "LiKJ2vnRg5ETM8Z19K7",
  "isRemoveAllFollowers": true,
  "followersActionType": "add",
  "name": "opportunity name",
  "status": "open",
  "pipelineStageId": "7915dedc-8f18-44d5-8bc3-77c04e994a10",
  "monetaryValue": 220,
  "assignedTo": "082goXVW3lIExEQPOnd3",
  "lostReasonId": "CLu7BaljjqrEjBGKTNNe"
}
Send API Request