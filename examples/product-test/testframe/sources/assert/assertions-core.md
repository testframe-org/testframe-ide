-------------------
base-url: http://localhost:18080/api/v2/assertions
-------------------
# Assertion language (JSONata subset)

```
assert <expr> (== | != | > | >= | < | <=) <expr>
```

The input is every variable published so far in the frame, by var-name
(e.g. `activeProducts`, `echoResult`): `assert $count(activeProducts) > 0`.
Paths use JSONata semantics (`A.B.C`, projection `.(price * qty)`, root `$` = all variables).
Functions: `$sum` `$count` `$avg` `$min` `$max` `$length` `$number`.
