-------------------
title: Assert active products
type: validation
phase: post
order: 2
source: assert/assertions-core
timeout: 1000
--------body----------
assert $count($) > 0
