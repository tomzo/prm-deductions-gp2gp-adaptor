import request from 'supertest';
import app from '../app';
import logger from '../config/logging';
import sendEhrRequest from '../services/ehr-request';
import { getHealthCheck } from '../services/get-health-check';
import MhsError from '../services/mhs/mhs-error';

jest.mock('../services/ehr-request');
jest.mock('../config/logging');
jest.mock('../services/get-health-check');

describe('app', () => {
  describe('GET /health', () => {
    beforeEach(() => {
      getHealthCheck.mockReturnValue(
        Promise.resolve({
          details: {
            filestore: {
              available: true,
              writable: true
            },
            mhs: {
              connected: true
            }
          }
        })
      );
    });

    it('should return a 200 status code', done => {
      request(app)
        .get('/health')
        .expect(200)
        .end(done);
    });
  });

  describe('POST /ehr-request', () => {
    const validRequestBody = { nhsNumber: 'some-nhs-number', odsCode: 'some-odsCode' };

    beforeEach(() => {
      process.env.AUTHORIZATION_KEYS = 'correct-key,other-key';
      sendEhrRequest.mockResolvedValue();
    });

    afterEach(() => {
      if (process.env.AUTHORIZATION_KEYS) {
        delete process.env.AUTHORIZATION_KEYS;
      }
    });

    it('should return a 202 status code', done => {
      request(app)
        .post('/ehr-request')
        .send(validRequestBody)
        .set('Authorization', 'correct-key')
        .expect(202)
        .end(done);
    });

    it('should return a 422 and error when NHS number was not provided', done => {
      request(app)
        .post('/ehr-request')
        .send({ odsCode: 'some-odsCode' })
        .set('Authorization', 'correct-key')
        .expect(422)
        .expect('Content-Type', /json/)
        .expect(res => {
          expect(res.body).toEqual({ errors: [{ nhsNumber: 'Invalid value' }] });
        })
        .end(done);
    });

    it('should update log event when NHS number was not provided', done => {
      request(app)
        .post('/ehr-request')
        .send({ odsCode: 'some-odsCode' })
        .set('Authorization', 'correct-key')
        .expect(() => {
          expect(logger.info).toHaveBeenCalledWith('Event finished', {
            event: {
              status: 'validation-failed',
              validation: { status: 'failed', errors: [{ nhsNumber: 'Invalid value' }] }
            }
          });
        })
        .end(done);
    });

    it('should return a 422 and error when ODS code was not provided', done => {
      request(app)
        .post('/ehr-request')
        .send({ nhsNumber: 'some-nhs-number' })
        .set('Authorization', 'correct-key')
        .expect(422)
        .expect('Content-Type', /json/)
        .expect(res => {
          expect(res.body).toEqual({ errors: [{ odsCode: 'Invalid value' }] });
        })
        .end(done);
    });

    it('should update log event when ODS code was not provided', done => {
      request(app)
        .post('/ehr-request')
        .send({ nhsNumber: 'some-nhs-number' })
        .set('Authorization', 'correct-key')
        .expect(() => {
          expect(logger.info).toHaveBeenCalledWith('Event finished', {
            event: {
              status: 'validation-failed',
              validation: { status: 'failed', errors: [{ odsCode: 'Invalid value' }] }
            }
          });
        })
        .end(done);
    });

    it('should return a 401 when no authorization header provided', done => {
      request(app)
        .post('/ehr-request')
        .expect(401)
        .end(done);
    });

    it('should update log event when no authorization header provided', done => {
      request(app)
        .post('/ehr-request')
        .expect(() => {
          expect(logger.info).toHaveBeenCalledWith('Event finished', {
            event: {
              status: 'authorization-failed',
              error: { message: 'Authorization header not provided' }
            }
          });
        })
        .end(done);
    });

    it('should return a 403 when authorization key is incorrect', done => {
      request(app)
        .post('/ehr-request')
        .set('Authorization', 'incorrect-key')
        .expect(403)
        .end(done);
    });

    it('should update log event when authorization key is incorrect', done => {
      request(app)
        .post('/ehr-request')
        .set('Authorization', 'incorrect-key')
        .expect(() => {
          expect(logger.info).toHaveBeenCalledWith('Event finished', {
            event: {
              status: 'authorization-failed',
              error: { message: 'Authorization header value is not a valid authorization key' }
            }
          });
        })
        .end(done);
    });

    it('should return a 503 when sending the EHR request is unsuccessful', done => {
      sendEhrRequest.mockRejectedValue(new MhsError('there was an error!'));

      request(app)
        .post('/ehr-request')
        .send(validRequestBody)
        .set('Authorization', 'correct-key')
        .expect(503)
        .expect(res => {
          expect(res.body).toEqual({ error: 'there was an error!' });
        })
        .end(done);
    });

    it('should update the log event when sending the EHR request is unsuccessful', done => {
      sendEhrRequest.mockRejectedValue(new MhsError('there was an error!'));

      request(app)
        .post('/ehr-request')
        .send(validRequestBody)
        .set('Authorization', 'correct-key')
        .expect(() => {
          expect(logger.info).toHaveBeenCalledWith('Event finished', {
            event: {
              status: 'validation-passed',
              validation: {
                status: 'passed'
              },
              error: {
                message: 'there was an error!',
                stack: expect.any(String)
              }
            }
          });
        })
        .end(done);
    });

    it('should return a 500 for any unexpected error', done => {
      sendEhrRequest.mockRejectedValue(new Error('there was an error!'));

      request(app)
        .post('/ehr-request')
        .send(validRequestBody)
        .set('Authorization', 'correct-key')
        .expect(500)
        .expect(res => {
          expect(res.body).toEqual({ error: 'there was an error!' });
        })
        .end(done);
    });

    it('should update the log event for any unexpected error', done => {
      sendEhrRequest.mockRejectedValue(new Error('there was an error!'));

      request(app)
        .post('/ehr-request')
        .send(validRequestBody)
        .set('Authorization', 'correct-key')
        .expect(() => {
          expect(logger.info).toHaveBeenCalledWith('Event finished', {
            event: {
              status: 'validation-passed',
              validation: {
                status: 'passed'
              },
              error: {
                message: 'there was an error!',
                stack: expect.any(String)
              }
            }
          });
        })
        .end(done);
    });
  });
});
