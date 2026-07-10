---
title: Computation for astrophysical inference
summary: I use statistical modelling and scientific software to turn imperfect astronomical measurements into interpretable physical constraints.
kicker: Computational astrophysics
order: 1
featured: true
tags:
  - Bayesian inference
  - radio astronomy
  - reproducible computing
links:
  - label: spectral_fit on GitHub
    url: https://github.com/QZGao/spectral_fit
---

My research interests sit where astrophysics, statistics, and software meet. I am particularly interested in inference problems where the observations are sparse or noisy, the models are physically structured, and uncertainty is part of the result rather than an afterthought.

One practical expression of this work is [`spectral_fit`](https://github.com/QZGao/spectral_fit), a Python package for fitting pulsar radio spectra with Bayesian methods. It treats model comparison, uncertainty, and reproducibility as parts of the scientific argument—not merely implementation details.

The longer-term question is methodological: how can computational tools preserve the assumptions and provenance behind an inference well enough that another researcher can inspect, reproduce, and extend it?
