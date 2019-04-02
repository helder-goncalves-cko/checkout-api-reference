#!/usr/bin/env node
'use strict';
var request = require('request');
var YAML = require('yamljs');
var fs = require('fs');
require('shelljs/global');
set('-e');
set('-v');

var syncPaymentSources = function()
{
  syncPaymentRequest('Giropay', 'http://sb-gateway-internal.cko.lon/giropay-internal/giropay/relations/gw/pay', '08');
  syncPaymentResponse('Giropay', 'http://sb-gateway-internal.cko.lon/giropay-internal/giropay/relations/gw/payment', '04');
  syncPaymentRequest('Ideal', 'http://sb-gateway-internal.cko.lon/ideal-internal-api/relations/gw/pay', '09');
  syncPaymentResponse('Ideal', 'http://sb-gateway-internal.cko.lon/ideal-internal-api/relations/gw/payment', '05');
  syncPaymentRequest('Klarna', 'http://sb-gateway-internal.cko.lon/klarna-internal/relations/gw/pay', '10');
  syncPaymentResponse('Klarna', 'http://sb-gateway-internal.cko.lon/klarna-internal/relations/gw/payment', '06');
  syncPaymentRequest('Bancontact', 'http://sb-gateway-internal.cko.lon/ppro-internal/bancontact/relations/gw/pay', '15');
  syncPaymentResponse('Bancontact', 'http://sb-gateway-internal.cko.lon/ppro-internal/bancontact/relations/gw/payment', '15');
  syncPaymentRequest('WeChat QR', 'http://sb-gateway-internal.cko.lon/fomo-internal/wechat-qr/relations/gw/pay', '16');
  syncPaymentResponse('WeChat QR', 'http://sb-gateway-internal.cko.lon/fomo-internal/wechat-qr/relations/gw/payment', '16');
  syncPaymentRequest('WeChat Web', 'http://sb-gateway-internal.cko.lon/fomo-internal/wechat-web/relations/gw/pay', '17');
  syncPaymentResponse('WeChat Web', 'http://sb-gateway-internal.cko.lon/fomo-internal/wechat-web/relations/gw/payment', '17');
  syncPaymentRequest('Unionpay', 'http://sb-gateway-internal.cko.lon/fomo-internal/unionpay/relations/gw/pay', '18');
  syncPaymentResponse('Unionpay', 'http://sb-gateway-internal.cko.lon/fomo-internal/unionpay/relations/gw/payment', '18');
}

var syncPaymentRequest = function(paymentSourceName, paymentSpecUrl, outputFilePrefix) {
  var outputFilename =  outputFilePrefix + '_PaymentRequest' + paymentSourceName + 'Source.yaml'
  var outputFilePath = 'spec/components/schemas/Payments/RequestSources/' + outputFilename;
  var buildPaymentRequestFunction = getFunctionToBuildPaymentRequest(paymentSourceName);
  sync(paymentSpecUrl, buildPaymentRequestFunction, outputFilePath);
};

var syncPaymentResponse = function(paymentSourceName, paymentSpecUrl, outputFilePrefix) {
  var outputFilename =  outputFilePrefix + '_PaymentResponse' + paymentSourceName + 'Source.yaml'
  var outputFilePath = 'spec/components/schemas/Payments/ResponseSources/' + outputFilename;
  var buildPaymentResponseFunction = getFunctionToBuildPaymentResponse(paymentSourceName);
  sync(paymentSpecUrl, buildPaymentResponseFunction, outputFilePath);
};

var sync = function(paymentSpecUrl, buildPaymentResponseFunction, outputFilePath) {
  console.log('Requesting payment spec from: ' + paymentSpecUrl + ', to output: ' + outputFilePath);
  var buildOutputFunction = getFunctionToBuildYaml(buildPaymentResponseFunction);
  request({ url: paymentSpecUrl, json: true}, thenBuildOutputAndWrite(buildOutputFunction, outputFilePath));
};

var getFunctionToBuildPaymentRequest = function(paymentSourceName) {
  return function(responseBody) {
    var requestData = responseBody.put.requestBody.content['application/json'].schema.properties.request_data;
    if (requestData.properties.type) {
      delete requestData.properties.type;
    }
    addDescriptionToKlarnaPassthroughObjects(requestData, paymentSourceName);
    return {
      type: 'object',
      description: paymentSourceName + ' Source',
      allOf: [{
          $ref: '#/components/schemas/PaymentRequestSource',
        }, {
          type: 'object',
          required: requestData.required,
          properties: requestData.properties
        }
      ]
    };
  };
};

var addDescriptionToKlarnaPassthroughObjects = function(requestData, paymentSourceName) {
  Object.keys(requestData.properties).forEach(propertyName => {
    var property = requestData.properties[propertyName];
    if (property['x-cko-passthrough'] === true && property['x-klarna-docs']) {
      var apmPropertyName = property['x-klarna-name'] || propertyName;
      var apmPropertyDocs = property['x-klarna-docs'];
      property.description += '  \nThis object is passed directly to ' + paymentSourceName + ' as `' + apmPropertyName + '`, ' +
                                '\nso for the object definition use the [' + paymentSourceName + ' documentation](' + apmPropertyDocs + ').';
    }
  });
};

var getFunctionToBuildPaymentResponse = function(paymentSourceName) {
  return function(responseBody) {
    var properties = responseBody.get.responses[200].content['application/json'].schema.properties;
    var responseDataProperties = null;

    //Some APMS don't set response_data if they don't have any. (e.g. fomo)
    if (properties && properties.response_data) {
      responseDataProperties = properties.response_data.properties;
      if (responseDataProperties && responseDataProperties.type) {
        delete responseDataProperties.type;
      }
    }
    return {
      type: 'object',
      description: paymentSourceName + ' Source',
      allOf: [{
          $ref: '#/components/schemas/PaymentResponseSource',
        }, {
          type: 'object',
          properties: responseDataProperties
        }
      ]
    };
  };
};

var getFunctionToBuildYaml = function(buildOutputFunction) {
  return function(responseBody) {
    var builtOutput = buildOutputFunction(responseBody);
    var generatedFileWarningComment = '###\n# Warning: this file was auto generated from OpenAPI specs using \'npm run sync-generated-specs\'. Do not manually edit. \n###\n';
    return generatedFileWarningComment + YAML.stringify(builtOutput, 20, 2);
  };
};

var thenBuildOutputAndWrite = function(buildOutputFunction, outputFilePath) {
  return function(error, response, responseBody) {
    if (error || response.statusCode !== 200) {
      handleRequestError(error, response);
    } else {
      console.log('Response from url received.');
      var builtOutput = buildOutputFunction(responseBody);
      fs.writeFile(outputFilePath, builtOutput, thenHandleFileWrite(outputFilePath));
    }
  }
};

var handleRequestError = function(error, response) {
  console.log('Invalid response from url. Error = ' + error);
  if (response) {
    console.log('response.statusCode = ' + response.statusCode);
  }
};

var thenHandleFileWrite = function(outputFilePath) {
  return function (error) {
    if (error) {
      console.log('File write error received: ' + error);
    } else {
      console.log('File written to ' + outputFilePath);
    }
  }
}; 

syncPaymentSources();