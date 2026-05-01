'use strict';

const metricsService = require('../services/metricsService');
const { notFound }   = require('../utils/errors');

async function getOne(req, res, next) {
  try {
    const data = await metricsService.getMetrics(req.params.id);
    if (!data) throw notFound(`Server '${req.params.id}' not found`);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

module.exports = { getOne };
