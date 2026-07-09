from selenium import webdriver
from selenium.webdriver.common.by import By
import time

options = webdriver.ChromeOptions()
options.add_argument('--headless')
options.add_argument('--no-sandbox')
options.add_argument('--disable-dev-shm-usage')
options.add_argument('--window-size=1280,900')
driver = webdriver.Chrome(options=options)

def set_input(id, value):
    el = driver.find_element(By.ID, id)
    el.clear()
    el.send_keys(value)

try:
    driver.get('http://127.0.0.1:5000/login')
    time.sleep(1)
    driver.find_element(By.CSS_SELECTOR, '#loginForm button[type="submit"]').click()
    time.sleep(3)
    driver.get('http://127.0.0.1:5000/')
    time.sleep(2)
    driver.find_element(By.ID, 'homePayrollBtn').click()
    time.sleep(2)

    output = driver.find_element(By.ID, 'homeReportsOutput')
    text = output.text
    print('Initial state:')
    print(text[:400].encode('ascii', errors='ignore').decode())
    print('Edit buttons:', len(driver.find_elements(By.CSS_SELECTOR, '.home-payroll-edit')))

    # Add employee
    set_input('homePayrollName', 'varun')
    set_input('homePayrollCategory', 'helper')
    set_input('homePayrollBase', '20000')
    set_input('homePayrollAdvance', '106')
    set_input('homePayrollRemarks', 'site travel')
    set_input('homePayrollNextAdvanceDate', '2026-07-20')
    driver.find_element(By.ID, 'homePayrollSaveBtn').click()
    time.sleep(3)

    output = driver.find_element(By.ID, 'homeReportsOutput')
    text = output.text
    print('\nAfter adding employee:')
    print(text[:500].encode('ascii', errors='ignore').decode())
    print('Edit buttons:', len(driver.find_elements(By.CSS_SELECTOR, '.home-payroll-edit')))

    # Click edit on first row
    edit_btns = driver.find_elements(By.CSS_SELECTOR, '.home-payroll-edit')
    if edit_btns:
        edit_btns[0].click()
        time.sleep(3)
        output = driver.find_element(By.ID, 'homeReportsOutput')
        text = output.text
        print('\nAfter clicking edit (should show Update Employee button):')
        print(text[:500].encode('ascii', errors='ignore').decode())
        print('Update button present:', 'Update Employee' in text)

        # Add another advance
        set_input('homePayrollAddAdvance', '500')
        set_input('homePayrollRemarks', 'tools')
        set_input('homePayrollNextAdvanceDate', '2026-08-01')
        driver.find_element(By.ID, 'homePayrollSaveBtn').click()
        time.sleep(3)
        output = driver.find_element(By.ID, 'homeReportsOutput')
        text = output.text
        print('\nAfter adding second advance:')
        print(text[:700].encode('ascii', errors='ignore').decode())

    logs = driver.get_log('browser')
    errors = [l for l in logs if l['level'] in ('SEVERE', 'ERROR') and 'favicon' not in l['message']]
    print('\nConsole errors:', len(errors))
    for e in errors[:5]:
        print('  ', e['message'][:200])
finally:
    driver.quit()
