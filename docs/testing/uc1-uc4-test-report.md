# Use Case Testing Report — UC-1 to UC-4

**Project:** Hospital Ward Management System  
**Team:** MedBase  
**Author:** Bauyrzhanuly Kuanyshbek  
**Date:** 11 November 2026  
**Related PR:** #4  
**Status:** PASSED

## 1. Objective

Verify that the Hospital Ward Management System correctly tracks patients across hospital wards during admission, transfer, and discharge.

The testing covers four use cases:

- UC-1: Patient Registration and Admission
- UC-2: Patient Transfer
- UC-3: Patient Discharge
- UC-4: Ward Occupancy Monitoring

## 2. Test Environment

- Backend: Python 3.12, FastAPI
- Database: PostgreSQL 17
- Frontend: React
- Containerization: Docker
- Testing framework: pytest 9.1.1

## 3. Test Scenarios and Results

| Test Scenario | Expected Result | Actual Result | Status |
|---|---|---|---|
| UC-1: Admit patient | Patient appears in Ward 102; occupancy increases from 2 to 3 | Patient admitted; occupancy 3/4 | PASS |
| UC-2: Transfer patient | Patient moves from Ward 102 to Ward 103 | Ward 102: 2/4; Ward 103: 1/3 | PASS |
| UC-3: Discharge patient | Patient removed from active admissions; bed becomes available | Patient discharged; Ward 103: 0/3 | PASS |
| UC-4: Ward occupancy | Occupancy matches active patient records | Consistent across tested wards | PASS |

## 4. Automated Testing

**Test file:** `backend/tests/test_admissions.py`

**New integration test:** `test_patient_admission_transfer_discharge_lifecycle`

The integration test verifies:

- Initial ward occupancy.
- Successful patient admission.
- Patient transfer between wards.
- Successful discharge.
- Removal from active admissions.
- Consistency between `/api/wards` and `/api/admissions/active`.

**Test execution result:**

- Total tests: 27
- Passed: 27
- Failed: 0
- Warnings: 1 (Starlette dependency deprecation)
- Execution time: 7.84 seconds

## 5. Manual UI Testing

The same patient lifecycle was manually tested through the React web interface using the local test environment.

Test patient: Dana Seitkali

Observed sequence:

1. Initial state: 4 active patients, 10 available beds.
2. Admission to Ward 102: 5 active patients, 9 available beds.
3. Transfer to Ward 103: 5 active patients, 9 available beds.
4. Discharge: 4 active patients, 10 available beds.

The interface correctly reflected the changes after each operation.

## 6. Conclusion

The tested patient lifecycle scenarios worked as expected.

No functional defects were observed in the tested admission, transfer, discharge, or ward occupancy operations.

The new integration test provides regression coverage for future changes to the backend and database.

This report documents the Week 11 Use Case Testing activity.