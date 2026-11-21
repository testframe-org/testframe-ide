-------------------
base-url: http://localhost:18080/api/v2/assertions
--------body----------
# Assertion language (JSONata subset)

```
assert <expr> (== | != | > | >= | < | <=) <expr>
```

Paths use JSONata semantics (`A.B.C`, projection `.(Price * Quantity)`, root `$`).
Functions: `$sum` `$count` `$avg` `$min` `$max` `$length` `$number`.
