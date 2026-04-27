'use strict';

const metricsService = require('../services/metricsService');
const { notFound } = require('../utils/errors');

async function getOne(req, res, next) {
  try {
    const metrics = await metricsService.getServerMetrics(req.params.id);
    if (!metrics) return next(notFound(`Server '${req.params.id}' not found`));
    res.json({ data: metrics });
  } catch (err) {
    next(err);
  }
}

module.exports = { getOne };
