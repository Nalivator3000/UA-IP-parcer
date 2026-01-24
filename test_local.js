#!/usr/bin/env node
/**
 * Локальный тест API экспорта IP+UA
 * Запуск: node test_local.js
 */

const http = require('http');

const BASE_URL = 'http://localhost:3000';
const TIMEOUT = 30000; // 30 секунд

function makeRequest(path, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const options = {
            hostname: url.hostname,
            port: url.port || 3000,
            path: url.pathname,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: TIMEOUT
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    resolve({ status: res.statusCode, data: json });
                } catch (e) {
                    resolve({ status: res.statusCode, data: body });
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        if (data) {
            req.write(JSON.stringify(data));
        }
        req.end();
    });
}

async function testAPI() {
    console.log('🧪 Локальное тестирование API экспорта IP+UA\n');
    console.log('='.repeat(60));
    
    let testsPassed = 0;
    let testsFailed = 0;
    
    // Тест 1: Health check
    console.log('\n1. Тест: Health check');
    try {
        const result = await makeRequest('/api/health');
        if (result.status === 200 && result.data.status === 'ok') {
            console.log('   ✅ PASSED');
            testsPassed++;
        } else {
            console.log('   ❌ FAILED:', result);
            testsFailed++;
        }
    } catch (error) {
        console.log('   ❌ FAILED:', error.message);
        testsFailed++;
    }
    
    // Тест 2: Получение типов событий
    console.log('\n2. Тест: Получение типов событий');
    try {
        const result = await makeRequest('/api/event-types');
        if (result.status === 200 && Array.isArray(result.data) && result.data.length > 0) {
            console.log(`   ✅ PASSED - Получено ${result.data.length} типов событий`);
            console.log('   Примеры:', result.data.slice(0, 5).map(e => e.event_type).join(', '));
            testsPassed++;
        } else {
            console.log('   ❌ FAILED:', result);
            testsFailed++;
        }
    } catch (error) {
        console.log('   ❌ FAILED:', error.message);
        testsFailed++;
    }
    
    // Тест 3: Тестовый экспорт (маленький период)
    console.log('\n3. Тест: Экспорт данных (маленький период)');
    try {
        const testData = {
            startDate: '2025-12-25',
            endDate: '2025-12-25',
            eventTypes: ['deposit'],
            minDeposit: '',
            maxDeposit: '',
            withoutEvents: []
        };
        
        console.log('   Параметры:', JSON.stringify(testData));
        
        const startTime = Date.now();
        const result = await makeRequest('/api/export', 'POST', testData);
        const duration = Date.now() - startTime;
        
        if (result.status === 200) {
            console.log(`   ✅ PASSED - Экспорт завершен за ${duration}ms`);
            console.log(`   Размер ответа: ${JSON.stringify(result.data).length} байт`);
            testsPassed++;
        } else {
            console.log('   ❌ FAILED:', result);
            testsFailed++;
        }
    } catch (error) {
        console.log('   ❌ FAILED:', error.message);
        testsFailed++;
    }
    
    // Тест 4: Валидация (без событий)
    console.log('\n4. Тест: Валидация (без выбранных событий)');
    try {
        const testData = {
            startDate: '2025-12-25',
            endDate: '2025-12-25',
            eventTypes: [],
            minDeposit: '',
            maxDeposit: '',
            withoutEvents: []
        };
        
        const result = await makeRequest('/api/export', 'POST', testData);
        // Ожидаем ошибку или пустой результат
        if (result.status !== 200 || result.data.error) {
            console.log('   ✅ PASSED - Валидация работает');
            testsPassed++;
        } else {
            console.log('   ⚠️  WARNING - Валидация не сработала');
            testsFailed++;
        }
    } catch (error) {
        console.log('   ✅ PASSED - Валидация работает (ошибка поймана)');
        testsPassed++;
    }
    
    // Итоги
    console.log('\n' + '='.repeat(60));
    console.log(`\n📊 Результаты тестирования:`);
    console.log(`   ✅ Пройдено: ${testsPassed}`);
    console.log(`   ❌ Провалено: ${testsFailed}`);
    console.log(`   Всего тестов: ${testsPassed + testsFailed}`);
    
    if (testsFailed === 0) {
        console.log('\n🎉 Все тесты пройдены успешно!');
        process.exit(0);
    } else {
        console.log('\n⚠️  Некоторые тесты провалились. Проверьте логи выше.');
        process.exit(1);
    }
}

// Проверка, что сервер запущен
console.log('Проверка подключения к серверу...');
makeRequest('/api/health')
    .then(() => {
        console.log('✅ Сервер доступен, начинаем тестирование\n');
        return testAPI();
    })
    .catch((error) => {
        console.error('❌ Ошибка подключения к серверу:', error.message);
        console.error('\nУбедитесь, что сервер запущен:');
        console.error('  cd csv_export_app');
        console.error('  npm start');
        process.exit(1);
    });

