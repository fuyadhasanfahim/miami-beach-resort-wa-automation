'use strict';

const { MongoClient } = require('mongodb');

async function createStore({ databaseUrl, instanceKey }) {
  const client = new MongoClient(databaseUrl);
  await client.connect();

  const db = client.db();
  const replied = db.collection('replied_senders');
  const jobs = db.collection('pending_jobs');

  await jobs.createIndex({ instance: 1, status: 1, enqueuedAt: 1 });

  const key = (sender) => `${instanceKey}:${sender}`;

  async function hasReplied(sender) {
    const doc = await replied.findOne({ _id: key(sender) }, { projection: { _id: 1 } });
    return !!doc;
  }

  async function markReplied(sender) {
    try {
      await replied.insertOne({
        _id: key(sender),
        instance: instanceKey,
        sender,
        repliedAt: new Date(),
      });
    } catch (err) {
      if (!(err && err.code === 11000)) throw err;
    }
  }

  async function enqueue({ sender, chatId }) {
    if (await hasReplied(sender)) return 'already_replied';
    try {
      await jobs.insertOne({
        _id: key(sender),
        instance: instanceKey,
        sender,
        chatId,
        status: 'pending',
        progress: 0,
        attempts: 0,
        enqueuedAt: new Date(),
        startedAt: null,
      });
      return 'queued';
    } catch (err) {
      if (err && err.code === 11000) return 'already_queued';
      throw err;
    }
  }

  async function claimNextJob() {
    return jobs.findOneAndUpdate(
      { instance: instanceKey, status: 'pending' },
      { $set: { status: 'processing', startedAt: new Date() }, $inc: { attempts: 1 } },
      { sort: { enqueuedAt: 1 }, returnDocument: 'after' }
    );
  }

  async function setJobProgress(sender, progress) {
    await jobs.updateOne({ _id: key(sender) }, { $set: { progress } });
  }

  async function completeJob(sender) {
    await markReplied(sender);
    await jobs.deleteOne({ _id: key(sender) });
  }

  async function requeueJob(sender) {
    await jobs.updateOne({ _id: key(sender) }, { $set: { status: 'pending' } });
  }

  async function resetStaleJobs() {
    const res = await jobs.updateMany(
      { instance: instanceKey, status: 'processing' },
      { $set: { status: 'pending' } }
    );
    return res.modifiedCount || 0;
  }

  async function pendingCount() {
    return jobs.countDocuments({
      instance: instanceKey,
      status: { $in: ['pending', 'processing'] },
    });
  }

  async function repliedCount() {
    return replied.countDocuments({ instance: instanceKey });
  }

  async function close() {
    await client.close();
  }

  return {
    hasReplied,
    markReplied,
    enqueue,
    claimNextJob,
    setJobProgress,
    completeJob,
    requeueJob,
    resetStaleJobs,
    pendingCount,
    repliedCount,
    close,
  };
}

module.exports = { createStore };
