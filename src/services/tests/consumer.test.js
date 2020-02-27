import { ConnectFailover } from 'stompit';
import initialiseConsumer from '../consumer';
import config from '../../config';
import handleMessage from '../message-handler';
import logger from '../../config/logging';
import httpContext from 'async-local-storage';

httpContext.enable();

jest.mock('stompit');
jest.mock('uuid/v4', () => () => 'some-correlation-id');
jest.mock('../../config/logging');
jest.mock('../message-handler');

describe('initialiseConsumer', () => {
  const queue = { connect: jest.fn(), on: () => {} };
  const mockTransaction = {
    send: jest.fn(),
    commit: jest.fn(),
    abort: jest.fn()
  };
  const client = {
    subscribe: jest.fn(),
    begin: jest.fn(),
    ack: jest.fn(),
    nack: jest.fn()
  };
  const message = { readString: jest.fn(), pipe: jest.fn() };
  const frame = { write: jest.fn(), end: jest.fn() };

  afterAll(() => {
    config.queueUrl1 = process.env.MHS_QUEUE_URL_1;
    config.queueUrl2 = process.env.MHS_QUEUE_URL_2;
    config.queueUsername = process.env.MHS_QUEUE_USERNAME;
    config.queuePassword = process.env.MHS_QUEUE_PASSWORD;
    config.stompVirtualHost = process.env.MHS_STOMP_VIRTUAL_HOST;
  });

  beforeEach(() => {
    config.queueUrl1 = 'stomp+ssl://some-url:some-port';
    config.queueUrl2 = 'tcp://other-url:other-port';
    config.queueUsername = 'some-username';
    config.queuePassword = 'some-password';
    config.stompVirtualHost = '/';

    jest.clearAllMocks();

    client.begin.mockReturnValue(mockTransaction);
    mockTransaction.send.mockReturnValue(frame);
    message.readString.mockImplementation((encoding, callback) =>
      callback(null, 'some-message-body')
    );
    client.subscribe.mockImplementation((config, callback) => callback(null, message));
    client.ack.mockReturnValue(Promise.resolve());
    client.nack.mockReturnValue(Promise.resolve());
    queue.connect.mockImplementation(callback => callback(null, client));
    ConnectFailover.mockImplementation(() => queue);

    handleMessage.mockResolvedValue();
  });

  it('should connect to the broker with the correct config', () => {
    initialiseConsumer();

    expect(ConnectFailover).toHaveBeenCalledWith(
      [
        {
          connectHeaders: {
            login: 'some-username',
            passcode: 'some-password',
            host: '/'
          },
          host: 'some-url',
          port: 'some-port',
          ssl: true
        },
        {
          connectHeaders: {
            login: 'some-username',
            passcode: 'some-password',
            host: '/'
          },
          host: 'other-url',
          port: 'other-port',
          ssl: false
        }
      ],
      { maxReconnects: 1, initialReconnectDelay: 100 }
    );
  });

  it('should connect to the broker when there is no failover', () => {
    config.queueUrl2 = '';

    initialiseConsumer();

    expect(ConnectFailover).toHaveBeenCalledWith(
      [
        {
          connectHeaders: {
            login: 'some-username',
            passcode: 'some-password',
            host: '/'
          },
          host: 'some-url',
          port: 'some-port',
          ssl: true
        }
      ],
      { maxReconnects: 1, initialReconnectDelay: 100 }
    );
  });

  it('should throw if the queue urls are not configured correctly', () => {
    config.queueUrl1 = 'some-url-without-protocol:some-port';

    expect(() => initialiseConsumer()).toThrow(
      new Error('Queue url should have the format protocol://host:port')
    );
  });

  it('should throw when there is an error connecting to the broker', () => {
    const error = new Error('some-error-happened');
    queue.connect.mockImplementation(callback => callback(error));

    return expect(() => initialiseConsumer()).toThrow(error);
  });

  it('should subscribe to the queue with the correct config', () => {
    initialiseConsumer();

    expect(client.subscribe).toHaveBeenCalledWith(
      { destination: config.queueName, ack: 'client-individual' },
      expect.anything()
    );
  });

  it('should update the log event when there is an error subscribing to the queue', () => {
    const error = new Error('some-error-happened');
    client.subscribe.mockImplementation((config, callback) => callback(error, message));

    initialiseConsumer();

    expect(logger.info).toHaveBeenCalledWith('Event finished', {
      event: {
        status: 'Consuming received message',
        error: {
          message: 'some-error-happened',
          stack: expect.any(String)
        }
      }
    });
  });

  it('should throw when there is an error subscribing to the queue but no message', () => {
    const error = new Error('some-error-happened');
    client.subscribe.mockImplementation((config, callback) => callback(error));

    expect(() => initialiseConsumer()).toThrow(error);
  });

  it('should read the message from the queue with the correct encoding', () => {
    initialiseConsumer();

    expect(message.readString).toHaveBeenCalledWith('UTF-8', expect.anything());
  });

  it('should update log event when there is an error reading the message', () => {
    const error = new Error('some-error-happened');
    message.readString.mockImplementation((encoding, callback) =>
      callback(error, 'some-message-body')
    );

    initialiseConsumer();

    expect(logger.info).toHaveBeenCalledWith('Event finished', {
      event: {
        status: 'Consuming received message',
        error: {
          message: 'some-error-happened',
          stack: expect.any(String)
        }
      }
    });
  });

  it('should pass the message to the handler', () => {
    initialiseConsumer();
    expect(handleMessage).toHaveBeenCalledWith('some-message-body');
  });

  it('should acknowledge the message after handling', done => {
    initialiseConsumer();

    setImmediate(() => {
      expect(client.ack).toHaveBeenCalled();
      done();
    });
  });

  it('should log the event after handling', done => {
    initialiseConsumer();

    setImmediate(() => {
      expect(logger.info).toHaveBeenCalledWith('Event finished', {
        event: {
          status: 'Message Handled',
          mhs: {
            mqMessageId: undefined
          }
        }
      });
      done();
    });
  });

  it('should send a negative acknowledgement if handling the message fails', done => {
    const error = new Error('handling message failed');
    handleMessage.mockRejectedValue(error);

    initialiseConsumer();

    setImmediate(() => {
      expect(client.nack).toHaveBeenCalled();
      done();
    });
  });

  it('should log the error event if handling the message fails', done => {
    const error = new Error('handling message failed');
    handleMessage.mockRejectedValue(error);

    initialiseConsumer();

    setImmediate(() => {
      expect(logger.info).toHaveBeenCalledWith('Event finished', {
        event: {
          status: 'Consuming received message',
          error: {
            message: 'handling message failed',
            stack: expect.any(String)
          }
        }
      });
      done();
    });
  });
});