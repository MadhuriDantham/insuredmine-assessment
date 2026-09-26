const express = require('express');

const { collection } = require('../db');
const { cleanString, escapeRegex } = require('../helpers/normalize');

const router = express.Router();

function serializePolicy(policy) {
  return {
    policyId: policy._id,
    policy_number: policy.policy_number,
    policy_start_date: policy.policy_start_date,
    policy_end_date: policy.policy_end_date,
    user: policy.user_id
      ? {
          userId: policy.user_id._id,
          firstname: policy.user_id.firstname,
          email: policy.user_id.email,
          dob: policy.user_id.dob,
          phone: policy.user_id.phone,
          address: policy.user_id.address,
          state: policy.user_id.state,
          zip: policy.user_id.zip,
          gender: policy.user_id.gender,
          userType: policy.user_id.userType
        }
      : null,
    category: policy.category_id
      ? {
          categoryId: policy.category_id._id,
          category_name: policy.category_id.category_name
        }
      : null,
    carrier: policy.company_id
      ? {
          companyId: policy.company_id._id,
          company_name: policy.company_id.company_name
        }
      : null,
    agent: policy.agent_id
      ? {
          agentId: policy.agent_id._id,
          agent_name: policy.agent_id.agent_name
        }
      : null,
    account: policy.account_id
      ? {
          accountId: policy.account_id._id,
          account_name: policy.account_id.account_name
        }
      : null
  };
}

router.get('/search', async (req, res, next) => {
  try {
    const username = cleanString(req.query.username);
    if (!username) {
      return res.status(400).json({ error: 'username query parameter is required.' });
    }

    const exactName = new RegExp(`^${escapeRegex(username)}$`, 'i');
    const users = await collection('users').find({ firstname: exactName }, { projection: { _id: 1 } }).toArray();
    const userIds = users.map((user) => user._id);

    if (userIds.length === 0) {
      return res.json({ username, count: 0, policies: [] });
    }

    const policies = await collection('policies')
      .aggregate([
        { $match: { user_id: { $in: userIds } } },
        { $sort: { policy_start_date: 1, policy_number: 1 } },
        { $lookup: { from: 'users', localField: 'user_id', foreignField: '_id', as: 'user_id' } },
        { $unwind: { path: '$user_id', preserveNullAndEmptyArrays: true } },
        { $lookup: { from: 'lobs', localField: 'category_id', foreignField: '_id', as: 'category_id' } },
        { $unwind: { path: '$category_id', preserveNullAndEmptyArrays: true } },
        { $lookup: { from: 'carriers', localField: 'company_id', foreignField: '_id', as: 'company_id' } },
        { $unwind: { path: '$company_id', preserveNullAndEmptyArrays: true } },
        { $lookup: { from: 'agents', localField: 'agent_id', foreignField: '_id', as: 'agent_id' } },
        { $unwind: { path: '$agent_id', preserveNullAndEmptyArrays: true } },
        { $lookup: { from: 'user_accounts', localField: 'account_id', foreignField: '_id', as: 'account_id' } },
        { $unwind: { path: '$account_id', preserveNullAndEmptyArrays: true } }
      ])
      .toArray();

    return res.json({
      username,
      count: policies.length,
      policies: policies.map(serializePolicy)
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/aggregate', async (req, res, next) => {
  try {
    const users = await collection('users').aggregate([
      {
        $lookup: {
          from: 'policies',
          localField: '_id',
          foreignField: 'user_id',
          as: 'policies'
        }
      },
      {
        $addFields: {
          totalPolicies: { $size: '$policies' }
        }
      },
      {
        $project: {
          _id: 0,
          userId: '$_id',
          firstname: 1,
          email: 1,
          totalPolicies: 1,
          policies: 1
        }
      },
      { $sort: { firstname: 1, email: 1 } }
    ]).toArray();

    return res.json({ count: users.length, users });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
