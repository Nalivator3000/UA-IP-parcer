// Тестовый скрипт для проверки работы API экспорта IP+UA
const fetch = require('node-fetch');

const BASE_URL = 'http://localhost:3000';

async function testAPI() {
    console.log('🧪 Тестирование API экспорта IP+UA\n');
    
    // 1. Проверка health check
    console.log('1. Проверка health check...');
    try {
        const healthRes = await fetch(`${BASE_URL}/api/health`);
        const health = await healthRes.json();
        console.log('   ✅ Health check:', health);
    } catch (error) {
        console.error('   ❌ Health check failed:', error.message);
        return;
    }
    
    // 2. Проверка получения типов событий
    console.log('\n2. Проверка получения типов событий...');
    try {
        const eventTypesRes = await fetch(`${BASE_URL}/api/event-types`);
        const eventTypes = await eventTypesRes.json();
        console.log(`   ✅ Получено типов событий: ${eventTypes.length}`);
        console.log('   Первые 5:', eventTypes.slice(0, 5).map(e => e.event_type));
    } catch (error) {
        console.error('   ❌ Ошибка получения типов событий:', error.message);
        return;
    }
    
    // 3. Тестовый запрос на экспорт (маленький период)
    console.log('\n3. Тестовый запрос на экспорт...');
    const testData = {
        startDate: '2025-12-25',
        endDate: '2025-12-25',
        eventTypes: ['deposit'],
        minDeposit: '',
        maxDeposit: '',
        withoutEvents: []
    };
    
    console.log('   Параметры запроса:', JSON.stringify(testData, null, 2));
    
    try {
        const exportRes = await fetch(`${BASE_URL}/api/export`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(testData)
        });
        
        if (!exportRes.ok) {
            const error = await exportRes.text();
            console.error('   ❌ Ошибка экспорта:', error);
            return;
        }
        
        console.log('   ✅ Экспорт начался, читаю поток...');
        
        const reader = exportRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let progressCount = 0;
        let csvLines = 0;
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            
            // Парсим JSON прогресс и CSV
            let newlineIndex;
            while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                const line = buffer.substring(0, newlineIndex).trim();
                buffer = buffer.substring(newlineIndex + 1);
                
                if (line) {
                    if (line.startsWith('{') && line.endsWith('}')) {
                        try {
                            const update = JSON.parse(line);
                            if (update.progress !== undefined) {
                                progressCount++;
                                console.log(`   📊 Прогресс: ${update.progress}% - ${update.message}`);
                            }
                            if (update.error) {
                                console.error('   ❌ Ошибка:', update.error);
                                return;
                            }
                        } catch (e) {
                            // CSV данные
                            csvLines++;
                        }
                    } else {
                        csvLines++;
                    }
                }
            }
        }
        
        // Обрабатываем оставшийся буфер
        if (buffer.trim()) {
            csvLines++;
        }
        
        console.log(`\n   ✅ Экспорт завершен!`);
        console.log(`   📊 Получено обновлений прогресса: ${progressCount}`);
        console.log(`   📄 Получено строк CSV: ${csvLines}`);
        
    } catch (error) {
        console.error('   ❌ Ошибка при экспорте:', error.message);
        console.error('   Stack:', error.stack);
    }
    
    console.log('\n✅ Тестирование завершено!');
}

// Запуск тестов
testAPI().catch(console.error);


