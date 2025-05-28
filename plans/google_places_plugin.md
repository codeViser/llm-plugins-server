# PLUGIN NAME
Google Places Connector

# OVERVIEW (Markdown Supported)
Fetches detailed information about places (businesses, points of interest, etc.) by proxying requests to the Google Places API via your self-hosted TypingMind Plugin Server. This allows the LLM to answer queries like "Find coffee shops near the Eiffel Tower," or "What are the details of the Sagrada Familia?" with specific textual information.

**Requires your TypingMind Plugin Server to be deployed.** The plugin server URL and your Google Places API Key need to be specified in the user settings below.

**Important Notes:**
*   This plugin sends your Google Places API Key with each request to YOUR self-hosted plugin server. Your server then uses this key to query Google.
*   This plugin makes a `POST` request to your plugin server\'s `/google-places/query` endpoint.
*   Ensure your plugin server is reachable from the environment where TypingMind is running.

# OPENAI FUNCTION SPEC (enter this in "OpenAI Function Spec")
```json
{
  "name": "fetch_google_place_data_via_proxy",
  "description": "Fetches structured data about places by calling a proxy endpoint on your TypingMind Plugin Server. The server uses the API key configured in user settings to query Google Places API. Returns data as a JSON string for the LLM to interpret.",
  "parameters": {
    "type": "object",
    "properties": {
      "searchType": {
        "type": "string",
        "description": "Type of search to perform. Valid values are \'textsearch\' for general queries (e.g., \'restaurants in San Francisco\'), \'nearbysearch\' for places near a specific location, or \'details\' to get information about a specific place ID.",
        "enum": ["textsearch", "nearbysearch", "details"]
      },
      "query": {
        "type": "string",
        "description": "The text string to search for. For \'textsearch\', this is the main query (e.g., \'Eiffel Tower\'). For \'nearbysearch\', this acts as a keyword or type filter (e.g., \'cafe\', \'grocery store\'). Not used for \'details\' searchType."
      },
      "location": {
        "type": "string",
        "description": "Required for \'nearbysearch\' queryType. A string representing latitude,longitude (e.g., \'48.8584,2.2945\')."
      },
      "radius": {
        "type": "integer",
        "description": "Optional. Radius in meters for \'nearbysearch\'. Defaults to 1500m if not specified by the user or in server config."
      },
      "placeId": {
        "type": "string",
        "description": "Required for \'details\' searchType. The unique Place ID of the location to get details for."
      },
      "fields": {
        "type": "string",
        "description": "Optional. Comma-separated list of fields to return (e.g., \'name,formatted_address,opening_hours,rating,photos\'). Helps control data size and API costs. Refer to Google Places API documentation for available fields. Example: \'name,formatted_address,opening_hours/open_now,rating,types,geometry/location,business_status\' for search, or \'name,formatted_address,international_phone_number,opening_hours,website,rating,review,user_ratings_total,price_level,type,geometry,business_status,photos\' for details."
      }
    },
    "required": [
      "searchType"
    ]
  }
}
```

# CODE (enter this in "Code Implementation (JavaScript only)")
```javascript
async function fetch_google_place_data_via_proxy(params, userSettings) {
  const pluginServerUrl = userSettings.pluginServerUrl;
  const apiKey = userSettings.googlePlacesApiKey; // Get API key from user settings
  const defaultFieldsSearch = userSettings.defaultFieldsSearch || 'name,formatted_address,types,business_status,rating,geometry/location,opening_hours/open_now';
  const defaultFieldsDetails = userSettings.defaultFieldsDetails || 'name,formatted_address,international_phone_number,opening_hours,website,rating,review,user_ratings_total,price_level,type,geometry,business_status,photos';

  if (!pluginServerUrl) {
    throw new Error("TypingMind Plugin Server URL is missing. Please configure it in the plugin settings.");
  }
  if (!apiKey) {
    throw new Error("Google Places API Key is missing. Please configure it in the plugin settings.");
  }

  const endpoint = `${pluginServerUrl.replace(/\/$/, '')}/google-places/query`; // Ensure no trailing slash

  const body = {
    apiKey: apiKey, // Include the API key in the request body to the server
    searchType: params.searchType,
    query: params.query,
    location: params.location,
    radius: params.radius,
    placeId: params.placeId,
    fields: params.fields
  };

  // Apply default fields if not specified by the LLM
  if (!params.fields) {
    if (params.searchType === 'details') {
      body.fields = defaultFieldsDetails;
    } else {
      body.fields = defaultFieldsSearch;
    }
  }
  
  // Validate required parameters based on searchType
  if (params.searchType === 'nearbysearch' && !params.location) {
    throw new Error("The 'location' parameter (latitude,longitude string) is required for 'nearbysearch'.");
  }
  if (params.searchType === 'details' && !params.placeId) {
    throw new Error("The 'placeId' parameter is required for 'details' searchType.");
  }
  if (params.searchType === 'textsearch' && !params.query) {
    throw new Error("The 'query' parameter is required for 'textsearch'.");
  }


  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch (e) {
        const textError = await response.text();
        throw new Error(`Plugin Server error: ${response.status} ${response.statusText} - ${textError}`);
      }
      const message = errorData.message || JSON.stringify(errorData);
      throw new Error(`Plugin Server error: ${response.status} ${response.statusText} - ${message}`);
    }

    const data = await response.json();
    if (data.success === false || !data.responseObject) {
        throw new Error(`Plugin Server indicated failure: ${data.message || 'No data object returned'}`);
    }
    return JSON.stringify(data.responseObject);

  } catch (error) {
    console.error("Error calling Google Places proxy plugin:", error);
    return JSON.stringify({ error: true, message: error.message, details: error.toString() });
  }
}
```

# User settings (enter this in "User Settings (JSON, Optional)")
```json
[
  {
    "name": "pluginServerUrl",
    "label": "Your TypingMind Plugin Server URL",
    "type": "text",
    "required": true,
    "placeholder": "https://your-plugin-server.example.com"
  },
  {
    "name": "googlePlacesApiKey",
    "label": "Your Google Places API Key",
    "type": "password",
    "required": true,
    "placeholder": "Enter your Google Places API Key here"
  },
  {
    "name": "defaultFieldsSearch",
    "label": "Default Fields for Text/Nearby Search (comma-separated)",
    "type": "text",
    "default": "name,formatted_address,types,business_status,rating,geometry/location,opening_hours/open_now",
    "description": "Used if the LLM doesn\'t specify fields for textsearch or nearbysearch."
  },
  {
    "name": "defaultFieldsDetails",
    "label": "Default Fields for Place Details (comma-separated)",
    "type": "text",
    "default": "name,formatted_address,international_phone_number,opening_hours,website,rating,review,user_ratings_total,price_level,type,geometry,business_status,photos",
    "description": "Used if the LLM doesn\'t specify fields for a details search."
  }
]
``` 