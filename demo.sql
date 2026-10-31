SELECT "Patient"."FullName", "Ward"."WardName", "Admission"."AdmitDate"
FROM "Patient"
JOIN "Admission" ON "Patient"."PatientID" = "Admission"."PatientID"
JOIN "Ward" ON "Admission"."WardID" = "Ward"."WardID"
WHERE "Admission"."Status" = 'Active';

-- 1 number of remaining capacity
SELECT "WardName", "Capacity", "AvailableBeds" FROM "vw_WardCapacity";

-- 2 place a patient to the place
CALL sp_AdmitPatient(7, 102);

-- 3 trying to place a pationt to the place ICU, we will get "Ward ID 101 is full"
CALL sp_AdmitPatient(8, 101);