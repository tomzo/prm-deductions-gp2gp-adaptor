import axios from 'axios';
import { updateLogEventWithError } from '../middleware/logging';

const validateInputs = ({ interactionId, conversationId, message }) => {
  if (interactionId && conversationId && message) return;

  const errorMessages = [];
  if (!interactionId) errorMessages.push('interactionId must be passed in');
  if (!conversationId) errorMessages.push('conversationId must be passed in');
  if (!message) errorMessages.push('message must be passed in');

  const error = new Error(errorMessages);

  updateLogEventWithError(error);
  throw error;
};

const processXmlMessage = (xml = '') =>
  xml
    .trim()
    .replace(/\r?\n|\r/g, '')
    .replace(/>\s+</g, '><');

const url = 'http://url.com';

const sendMessage = ({ interactionId, conversationId, odsCode = 'YES', message } = {}) => {
  return new Promise((resolve, reject) => {
    validateInputs({ interactionId, conversationId, message });
    const axiosOptions = {
      headers: {
        'Content-Type': 'application/json',
        'Interaction-ID': interactionId,
        'Sync-Async': false,
        'Correlation-Id:': conversationId,
        'Ods-Code': odsCode
      },
      data: {
        payload: processXmlMessage(message)
      }
    };

    return axios
      .post(url, axiosOptions)
      .then(resolve)
      .catch(error => {
        const axiosError = new Error(
          `POST ${url} - ${error.message || 'Request failed'} - ${JSON.stringify(axiosOptions)}`
        );
        updateLogEventWithError(axiosError);
        reject(axiosError);
      });
  });
};

export { sendMessage, processXmlMessage };
