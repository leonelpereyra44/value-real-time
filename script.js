// Monitor S&P 500 en Tiempo Real
class SP500Monitor {
    constructor() {
        this.apiKey = 'DZ2T8P8IWJO6YJ5Y'; // Tu API key de Alpha Vantage
        this.symbol = 'SPY'; // ETF que sigue al S&P 500
        this.updateInterval = 300000; // 5 minutos
        this.chart = null;
        this.chartPeriod = '30d';
        this.db = null;
        this.dbName = 'SP500HistoricalData';
        this.dbVersion = 1;
        this.maxApiCallsPerDay = 2; // Limitar a 2 actualizaciones por día (cada 12h)
        this.init();
    }

    async init() {
        // Inicializar base de datos primero
        await this.initDB();
        
        // Inicializar el gráfico
        this.initChart();
        this.setupChartControls();
        
        // Cargar datos históricos desde DB o API
        await this.loadHistoricalDataFromDB();
        
        // Luego obtener el precio actual
        setTimeout(() => {
            this.updatePrice();
        }, 2000);
        
        // Configurar actualización automática solo para precio actual
        setInterval(() => this.updatePrice(), this.updateInterval);
        
        // Programar actualización de datos históricos (3 veces al día)
        this.scheduleHistoricalUpdates();
    }

    async initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            
            request.onerror = () => {
                console.error('Error opening database');
                reject(request.error);
            };
            
            request.onsuccess = () => {
                this.db = request.result;
                console.log('Database initialized successfully');
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Crear store para datos históricos
                if (!db.objectStoreNames.contains('historicalData')) {
                    const store = db.createObjectStore('historicalData', { keyPath: 'id' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                    store.createIndex('period', 'period', { unique: false });
                }
                
                // Crear store para metadatos (última actualización, etc.)
                if (!db.objectStoreNames.contains('metadata')) {
                    db.createObjectStore('metadata', { keyPath: 'key' });
                }
                
                console.log('Database schema created');
            };
        });
    }

    async scheduleHistoricalUpdates() {
        // Verificar si necesitamos actualizar datos históricos
        const shouldUpdate = await this.shouldUpdateHistoricalData();
        
        if (shouldUpdate) {
            console.log('Updating historical data from API...');
            await this.updateHistoricalDataFromAPI();
        }
        
        // Programar próximas actualizaciones (cada 12 horas)
        setInterval(async () => {
            const shouldUpdateNow = await this.shouldUpdateHistoricalData();
            if (shouldUpdateNow) {
                console.log('Scheduled update: fetching new historical data...');
                await this.updateHistoricalDataFromAPI();
            }
        }, 12 * 60 * 60 * 1000); // 12 horas
    }

    async shouldUpdateHistoricalData() {
        try {
            const lastUpdate = await this.getLastUpdateTime();
            const now = new Date().getTime();
            const twelveHours = 12 * 60 * 60 * 1000;
            
            // Actualizar si han pasado más de 12 horas desde la última actualización
            return !lastUpdate || (now - lastUpdate) > twelveHours;
        } catch (error) {
            console.log('Error checking last update time:', error);
            return true; // Si hay error, mejor actualizar
        }
    }

    async getLastUpdateTime() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['metadata'], 'readonly');
            const store = transaction.objectStore('metadata');
            const request = store.get('lastHistoricalUpdate');
            
            request.onsuccess = () => {
                resolve(request.result ? request.result.value : null);
            };
            
            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    async setLastUpdateTime(timestamp) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['metadata'], 'readwrite');
            const store = transaction.objectStore('metadata');
            const request = store.put({ key: 'lastHistoricalUpdate', value: timestamp });
            
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async loadHistoricalDataFromDB() {
        try {
            console.log(`Loading historical data from DB for period: ${this.chartPeriod}`);
            
            const data = await this.getHistoricalDataFromDB(this.chartPeriod);
            
            if (data && data.length > 0) {
                this.displayHistoricalData(data);
                this.updateDataStatus('real', `Datos desde DB (${data.length} puntos - ${this.chartPeriod})`);
                console.log(`Loaded ${data.length} data points from database for ${this.chartPeriod}`);
            } else {
                console.log('No data in DB, fetching from API...');
                await this.updateHistoricalDataFromAPI();
            }
        } catch (error) {
            console.error('Error loading from DB:', error);
            this.generateRealisticHistoricalData();
        }
    }

    async getHistoricalDataFromDB(period) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['historicalData'], 'readonly');
            const store = transaction.objectStore('historicalData');
            const index = store.index('period');
            const request = index.getAll(period);
            
            request.onsuccess = () => {
                const results = request.result;
                // Ordenar por timestamp
                results.sort((a, b) => a.timestamp - b.timestamp);
                resolve(results);
            };
            
            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    async saveHistoricalDataToDB(period, data) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['historicalData'], 'readwrite');
            const store = transaction.objectStore('historicalData');
            
            // Limpiar datos anteriores de este período
            const index = store.index('period');
            const deleteRequest = index.openCursor(IDBKeyRange.only(period));
            
            deleteRequest.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                } else {
                    // Una vez limpiados, guardar nuevos datos
                    let completed = 0;
                    const total = data.length;
                    
                    data.forEach((item, index) => {
                        const record = {
                            id: `${period}_${item.timestamp}`,
                            period: period,
                            timestamp: item.timestamp,
                            price: item.price,
                            date: item.date
                        };
                        
                        const addRequest = store.put(record);
                        addRequest.onsuccess = () => {
                            completed++;
                            if (completed === total) {
                                resolve();
                            }
                        };
                        addRequest.onerror = () => reject(addRequest.error);
                    });
                }
            };
            
            deleteRequest.onerror = () => reject(deleteRequest.error);
        });
    }

    displayHistoricalData(data) {
        const labels = [];
        const prices = [];
        
        data.forEach(item => {
            const date = new Date(item.timestamp);
            
            if (this.chartPeriod === '1d') {
                labels.push(date.toLocaleTimeString('es-ES', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                }));
            } else {
                labels.push(date.toLocaleDateString('es-ES', { 
                    month: 'short', 
                    day: 'numeric' 
                }));
            }
            
            prices.push(item.price);
        });

        this.chart.data.labels = labels;
        this.chart.data.datasets[0].data = prices;
        this.chart.update();
        
        this.clearError();
    }

    async updateHistoricalDataFromAPI() {
        try {
            console.log('Fetching fresh data from API for all periods...');
            
            const periods = ['1d', '7d', '30d'];
            let successCount = 0;
            
            for (const period of periods) {
                this.chartPeriod = period; // Temporalmente cambiar período
                
                const success = await this.tryYahooFinance();
                
                if (success) {
                    successCount++;
                    console.log(`Successfully updated ${period} data`);
                } else {
                    console.log(`Failed to update ${period} data`);
                }
                
                // Esperar un poco entre llamadas para no saturar la API
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
            // Restaurar período original
            this.chartPeriod = document.querySelector('.chart-btn.active').id.replace('btn', '') + 'd';
            
            if (successCount > 0) {
                await this.setLastUpdateTime(new Date().getTime());
                console.log(`Updated ${successCount}/${periods.length} periods successfully`);
                
                // Recargar datos del período actual
                await this.loadHistoricalDataFromDB();
            } else {
                console.log('All API calls failed, using existing data or generating realistic data');
                this.generateRealisticHistoricalData();
            }
            
        } catch (error) {
            console.error('Error updating historical data from API:', error);
            this.generateRealisticHistoricalData();
        }
    }

    async updatePrice() {
        try {
            const container = document.querySelector('.container');
            container.classList.add('updating');

            // Intentar obtener datos reales usando la misma API que funciona para el gráfico
            const success = await this.getCurrentPriceFromYahoo();
            
            if (!success) {
                // Si falla Yahoo Finance, intentar con Alpha Vantage
                const alphaSuccess = await this.getCurrentPriceFromAlpha();
                
                if (!alphaSuccess) {
                    // Como último recurso, simular datos
                    this.simulateData();
                }
            }
        } catch (error) {
            console.error('Error fetching current price:', error);
            this.showError('Error al obtener datos actuales. Mostrando valores simulados.');
            this.simulateData();
        } finally {
            document.querySelector('.container').classList.remove('updating');
        }
    }

    async getCurrentPriceFromYahoo() {
        try {
            const endpoints = [
                `https://query1.finance.yahoo.com/v8/finance/chart/${this.symbol}`,
                `https://query2.finance.yahoo.com/v8/finance/chart/${this.symbol}`,
                `https://api.allorigins.win/get?url=${encodeURIComponent(`https://query1.finance.yahoo.com/v8/finance/chart/${this.symbol}`)}`
            ];

            for (const endpoint of endpoints) {
                try {
                    console.log('Fetching current price from:', endpoint);
                    
                    const response = await fetch(endpoint, {
                        method: 'GET',
                        mode: 'cors'
                    });

                    if (response.ok) {
                        let data = await response.json();
                        
                        // Si usamos el proxy, extraer el contenido
                        if (endpoint.includes('allorigins')) {
                            data = JSON.parse(data.contents);
                        }

                        if (data.chart && data.chart.result && data.chart.result[0]) {
                            this.displayYahooCurrentPrice(data.chart.result[0]);
                            return true;
                        }
                    }
                } catch (endpointError) {
                    console.log(`Current price endpoint ${endpoint} failed:`, endpointError.message);
                    continue;
                }
            }

            return false;
        } catch (error) {
            console.log('Yahoo Finance current price failed:', error);
            return false;
        }
    }

    async getCurrentPriceFromAlpha() {
        try {
            const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${this.symbol}&apikey=${this.apiKey}`;
            
            const response = await fetch(url);
            const data = await response.json();

            if (data['Global Quote']) {
                this.displayData(data['Global Quote']);
                return true;
            }

            return false;
        } catch (error) {
            console.log('Alpha Vantage current price failed:', error);
            return false;
        }
    }

    displayData(quote) {
        const price = parseFloat(quote['05. price']);
        const change = parseFloat(quote['09. change']);
        const changePercent = parseFloat(quote['10. change percent'].replace('%', ''));
        const open = parseFloat(quote['02. open']);
        const high = parseFloat(quote['03. high']);
        const low = parseFloat(quote['04. low']);
        const volume = parseInt(quote['06. volume']);

        // Actualizar precio actual
        document.getElementById('currentPrice').textContent = `$${price.toFixed(2)}`;

        // Actualizar cambio
        const changeElement = document.getElementById('priceChange');
        const changeText = `${change >= 0 ? '+' : ''}${change.toFixed(2)} (${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%)`;
        changeElement.textContent = changeText;
        changeElement.className = `change ${change >= 0 ? 'positive' : 'negative'}`;

        // Actualizar información adicional
        document.getElementById('openPrice').textContent = `$${open.toFixed(2)}`;
        document.getElementById('highPrice').textContent = `$${high.toFixed(2)}`;
        document.getElementById('lowPrice').textContent = `$${low.toFixed(2)}`;
        document.getElementById('volume').textContent = this.formatNumber(volume);

        // Actualizar timestamp
        document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString('es-ES');
    }

    displayYahooCurrentPrice(result) {
        try {
            const meta = result.meta;
            const currentPrice = meta.regularMarketPrice;
            const previousClose = meta.previousClose;
            const change = currentPrice - previousClose;
            const changePercent = (change / previousClose) * 100;

            // Actualizar precio actual
            document.getElementById('currentPrice').textContent = `$${currentPrice.toFixed(2)}`;

            // Actualizar cambio
            const changeElement = document.getElementById('priceChange');
            const changeText = `${change >= 0 ? '+' : ''}${change.toFixed(2)} (${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%)`;
            changeElement.textContent = changeText;
            changeElement.className = `change ${change >= 0 ? 'positive' : 'negative'}`;

            // Actualizar información adicional usando los datos disponibles
            document.getElementById('openPrice').textContent = `$${(meta.regularMarketOpen || currentPrice).toFixed(2)}`;
            document.getElementById('highPrice').textContent = `$${(meta.regularMarketDayHigh || currentPrice * 1.02).toFixed(2)}`;
            document.getElementById('lowPrice').textContent = `$${(meta.regularMarketDayLow || currentPrice * 0.98).toFixed(2)}`;
            
            // Para el volumen, usar datos del resultado si están disponibles
            const timestamps = result.timestamp;
            const volumes = result.indicators?.quote?.[0]?.volume;
            let totalVolume = 0;
            
            if (volumes) {
                totalVolume = volumes.reduce((sum, vol) => sum + (vol || 0), 0);
            }
            
            if (totalVolume === 0) {
                totalVolume = Math.floor(Math.random() * 50000000 + 10000000); // Volumen estimado entre 10M-60M
            }
            
            document.getElementById('volume').textContent = this.formatNumber(totalVolume);

            // Actualizar timestamp
            document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString('es-ES');
            
            // Limpiar errores ya que obtuvimos datos reales
            this.clearError();
            
            console.log('Successfully updated current price from Yahoo Finance:', currentPrice);
        } catch (error) {
            console.error('Error processing Yahoo Finance current price:', error);
            return false;
        }
    }

    simulateData() {
        // Obtener el último precio del gráfico si está disponible para mantener consistencia
        let basePrice = 450; // Precio base por defecto
        
        if (this.chart && this.chart.data.datasets[0].data.length > 0) {
            const chartData = this.chart.data.datasets[0].data;
            basePrice = chartData[chartData.length - 1]; // Usar el último precio del gráfico
        } else {
            basePrice = 450 + Math.random() * 100; // Precio base entre 450-550
        }

        // Generar variación pequeña para mantener realismo
        const priceVariation = (Math.random() - 0.5) * 2; // Variación de ±1
        const currentPrice = basePrice + priceVariation;
        const change = (Math.random() - 0.5) * 5; // Cambio entre -2.5 y +2.5
        const changePercent = (change / currentPrice) * 100;

        const simulatedData = {
            '05. price': currentPrice.toString(),
            '09. change': change.toString(),
            '10. change percent': `${changePercent.toFixed(2)}%`,
            '02. open': (currentPrice - Math.random() * 3).toString(),
            '03. high': (currentPrice + Math.random() * 5).toString(),
            '04. low': (currentPrice - Math.random() * 5).toString(),
            '06. volume': Math.floor(Math.random() * 50000000 + 10000000).toString() // 10M-60M más realista para SPY
        };

        this.displayData(simulatedData);
        
        if (!document.getElementById('errorMessage').textContent) {
            this.showError('APIs temporalmente no disponibles. Mostrando datos estimados basados en el último precio conocido.');
        }
    }

    formatNumber(num) {
        if (num >= 1000000) {
            return (num / 1000000).toFixed(1) + 'M';
        } else if (num >= 1000) {
            return (num / 1000).toFixed(1) + 'K';
        }
        return num.toLocaleString();
    }

    showError(message) {
        const errorDiv = document.getElementById('errorMessage');
        errorDiv.textContent = message;
        errorDiv.className = 'error';
    }

    clearError() {
        const errorDiv = document.getElementById('errorMessage');
        errorDiv.textContent = '';
        errorDiv.className = '';
    }

    initChart() {
        const ctx = document.getElementById('priceChart').getContext('2d');
        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Precio S&P 500',
                    data: [],
                    borderColor: '#2196F3',
                    backgroundColor: 'rgba(33, 150, 243, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    x: {
                        display: true,
                        grid: {
                            color: 'rgba(0,0,0,0.1)'
                        }
                    },
                    y: {
                        display: true,
                        grid: {
                            color: 'rgba(0,0,0,0.1)'
                        },
                        ticks: {
                            callback: function(value) {
                                return '$' + value.toFixed(2);
                            }
                        }
                    }
                },
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                elements: {
                    point: {
                        hoverBackgroundColor: '#2196F3'
                    }
                }
            }
        });
        
        this.updateDataStatus('error', 'Cargando datos...');
        this.loadHistoricalDataFromDB();
    }

    setupChartControls() {
        const buttons = ['btn30d', 'btn7d', 'btn1d'];
        const periods = ['30d', '7d', '1d'];

        buttons.forEach((btnId, index) => {
            document.getElementById(btnId).addEventListener('click', () => {
                // Remover clase active de todos los botones
                buttons.forEach(id => {
                    document.getElementById(id).classList.remove('active');
                });
                
                // Agregar clase active al botón clickeado
                document.getElementById(btnId).classList.add('active');
                
                // Cambiar período y actualizar gráfico
                this.chartPeriod = periods[index];
                this.updateChartTitle();
                this.updateDataStatus('error', 'Cargando datos...');
                this.loadHistoricalDataFromDB();
            });
        });
    }

    async loadHistoricalData() {
        try {
            // Intentar directamente con Yahoo Finance a través de un proxy público
            const success = await this.tryYahooFinance();
            
            if (!success) {
                // Si falla Yahoo, intentar con Alpha Vantage
                const alphaSuccess = await this.tryAlphaVantageHistorical();
                
                if (!alphaSuccess) {
                    // Como último recurso, datos realistas
                    await this.generateRealisticHistoricalData();
                }
            }
            
        } catch (error) {
            console.error('Error loading historical data:', error);
            this.showError(`Error cargando datos históricos: ${error.message}. Mostrando datos simulados.`);
            this.generateSimulatedHistoricalData();
        }
    }

    async tryYahooFinance() {
        try {
            // Configurar parámetros según el período
            let period1, period2, interval;
            const now = Math.floor(Date.now() / 1000);
            
            switch(this.chartPeriod) {
                case '1d':
                    period1 = now - (24 * 60 * 60); // 1 día atrás
                    period2 = now;
                    interval = '5m';
                    break;
                case '7d':
                    period1 = now - (7 * 24 * 60 * 60); // 7 días atrás
                    period2 = now;
                    interval = '1d';
                    break;
                case '30d':
                default:
                    period1 = now - (30 * 24 * 60 * 60); // 30 días atrás
                    period2 = now;
                    interval = '1d';
            }

            // Priorizar Alpha Vantage para GitHub Pages (más confiable)
            const alphaSuccess = await this.tryAlphaVantageHistoricalForGitHub();
            if (alphaSuccess) return true;

            // Crear URLs con parámetros específicos como fallback
            const baseEndpoints = [
                'https://query1.finance.yahoo.com/v8/finance/chart/SPY',
                'https://query2.finance.yahoo.com/v8/finance/chart/SPY'
            ];

            const params = `?period1=${period1}&period2=${period2}&interval=${interval}&includePrePost=false&events=div%7Csplit`;

            for (const baseEndpoint of baseEndpoints) {
                try {
                    const endpoint = baseEndpoint + params;
                    console.log(`Trying endpoint for ${this.chartPeriod}:`, endpoint);
                    
                    const response = await fetch(endpoint, {
                        method: 'GET',
                        mode: 'cors',
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        }
                    });

                    if (response.ok) {
                        const data = await response.json();
                        
                        if (data.chart && data.chart.result && data.chart.result[0]) {
                            console.log(`Got data for ${this.chartPeriod}:`, data.chart.result[0].timestamp?.length, 'data points');
                            await this.processYahooFinanceData(data.chart.result[0]);
                            return true;
                        }
                    }
                } catch (endpointError) {
                    console.log(`Endpoint ${baseEndpoint} failed:`, endpointError.message);
                    continue;
                }
            }

            // Intentar con proxy como último recurso
            try {
                const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(baseEndpoints[0] + params)}`;
                console.log('Trying proxy:', proxyUrl);
                
                const response = await fetch(proxyUrl);
                if (response.ok) {
                    const proxyData = await response.json();
                    const data = JSON.parse(proxyData.contents);
                    
                    if (data.chart && data.chart.result && data.chart.result[0]) {
                        await this.processYahooFinanceData(data.chart.result[0]);
                        return true;
                    }
                }
            } catch (proxyError) {
                console.log('Proxy failed:', proxyError.message);
            }

            return false;
        } catch (error) {
            console.log('All Yahoo Finance endpoints failed:', error);
            return false;
        }
    }

    async tryAlphaVantageHistoricalForGitHub() {
        try {
            let timeFunction, outputsize = 'compact';
            
            // Usar funciones más confiables de Alpha Vantage para GitHub Pages
            // Solo usar datos diarios para mayor compatibilidad
            timeFunction = 'TIME_SERIES_DAILY';

            let url = `https://www.alphavantage.co/query?function=${timeFunction}&symbol=${this.symbol}&outputsize=${outputsize}&apikey=${this.apiKey}`;

            console.log('Fetching from Alpha Vantage (GitHub Pages optimized):', url);
            
            const response = await fetch(url);
            const data = await response.json();

            // Verificar si hay errores o límites de API
            if (data['Error Message']) {
                console.log('Alpha Vantage error:', data['Error Message']);
                return false;
            }
            
            if (data['Note'] && data['Note'].includes('API call frequency')) {
                console.log('Alpha Vantage rate limit reached');
                return false;
            }

            // Verificar si hay datos válidos
            const hasValidData = await this.processAlphaVantageHistoricalData(data);
            return hasValidData;
            
        } catch (error) {
            console.log('Alpha Vantage GitHub Pages optimized failed:', error.message);
            return false;
        }
    }

    async processAlphaVantageHistoricalData(data) {
        try {
            const timeSeries = data['Time Series (Daily)'];
            
            if (!timeSeries || Object.keys(timeSeries).length === 0) {
                console.log('No Alpha Vantage time series data found');
                return false;
            }

            const labels = [];
            const prices = [];
            const entries = Object.entries(timeSeries);

            // Filtrar datos según el período
            let filteredEntries;
            
            switch(this.chartPeriod) {
                case '1d':
                    // Para 1 día en GitHub Pages, mostrar últimos 3 días
                    filteredEntries = entries.slice(0, 3);
                    break;
                case '7d':
                    filteredEntries = entries.slice(0, 7);
                    break;
                case '30d':
                default:
                    filteredEntries = entries.slice(0, 30);
            }

            // Ordenar cronológicamente (más antiguo primero)
            filteredEntries.sort(([a], [b]) => new Date(a) - new Date(b));

            filteredEntries.forEach(([date, values]) => {
                const price = parseFloat(values['4. close']);
                
                labels.push(new Date(date).toLocaleDateString('es-ES', { 
                    month: 'short', 
                    day: 'numeric' 
                }));
                
                prices.push(price);
            });

            if (prices.length === 0) {
                return false;
            }

            // Guardar en base de datos
            const dbData = filteredEntries.map(([date, values]) => ({
                timestamp: new Date(date).getTime(),
                price: parseFloat(values['4. close']),
                date: date
            }));
            
            await this.saveHistoricalDataToDB(this.chartPeriod, dbData);

            this.chart.data.labels = labels;
            this.chart.data.datasets[0].data = prices;
            this.chart.update();

            this.updateDataStatus('real', `Datos Alpha Vantage (${prices.length} puntos - ${this.chartPeriod})`);
            this.clearError();
            console.log(`Successfully loaded ${prices.length} data points from Alpha Vantage for ${this.chartPeriod}`);
            return true;

        } catch (error) {
            console.error('Error processing Alpha Vantage historical data:', error);
            return false;
        }
    }

    async tryAlphaVantageHistorical() {
        try {
            let timeFunction, interval, outputsize = 'compact';
            
            switch(this.chartPeriod) {
                case '1d':
                    timeFunction = 'TIME_SERIES_INTRADAY';
                    interval = '15min';
                    break;
                case '7d':
                case '30d':
                default:
                    timeFunction = 'TIME_SERIES_DAILY';
                    interval = null;
                    outputsize = 'compact';
            }

            let url = `https://www.alphavantage.co/query?function=${timeFunction}&symbol=${this.symbol}&outputsize=${outputsize}&apikey=${this.apiKey}`;
            if (interval) {
                url += `&interval=${interval}`;
            }

            console.log('Fetching from Alpha Vantage:', url);
            
            const response = await fetch(url);
            const data = await response.json();

            // Verificar si hay errores o límites de API
            if (data['Error Message']) {
                throw new Error(data['Error Message']);
            }
            
            if (data['Note'] && data['Note'].includes('API call frequency')) {
                throw new Error('Límite de API alcanzado - reintentando en 1 minuto');
            }

            // Verificar si hay datos válidos
            const hasValidData = this.processHistoricalData(data);
            return hasValidData;
            
        } catch (error) {
            console.log('Alpha Vantage failed:', error.message);
            return false;
        }
    }

    async tryAlternativeHistorical() {
        try {
            // Intentar con diferentes fuentes de datos gratuitas
            console.log('Intentando fuentes alternativas para datos históricos...');
            
            // 1. Intentar con Polygon.io (gratuita con límites)
            const polygonSuccess = await this.tryPolygonAPI();
            if (polygonSuccess) return;
            
            // 2. Intentar con IEX Cloud (gratuita)
            const iexSuccess = await this.tryIEXCloudAPI();
            if (iexSuccess) return;
            
            // 3. Intentar con Finnhub (gratuita)
            const finnhubSuccess = await this.tryFinnhubAPI();
            if (finnhubSuccess) return;
            
            // 4. Como último recurso, usar datos más realistas
            await this.generateRealisticHistoricalData();
            
        } catch (error) {
            console.log('All alternative sources failed:', error.message);
            this.generateSimulatedHistoricalData();
        }
    }

    async tryPolygonAPI() {
        try {
            // Polygon.io API gratuita
            const apiKey = 'DEMO'; // Usar clave demo
            let url;
            
            const today = new Date();
            const fromDate = new Date();
            
            switch(this.chartPeriod) {
                case '1d':
                    // Datos de hoy cada 5 minutos
                    fromDate.setDate(today.getDate() - 1);
                    const fromStr = fromDate.toISOString().split('T')[0];
                    const toStr = today.toISOString().split('T')[0];
                    url = `https://api.polygon.io/v2/aggs/ticker/SPY/range/5/minute/${fromStr}/${toStr}?adjusted=true&sort=asc&apikey=${apiKey}`;
                    break;
                case '7d':
                    fromDate.setDate(today.getDate() - 7);
                    url = `https://api.polygon.io/v2/aggs/ticker/SPY/range/1/day/${fromDate.toISOString().split('T')[0]}/${today.toISOString().split('T')[0]}?adjusted=true&sort=asc&apikey=${apiKey}`;
                    break;
                case '30d':
                default:
                    fromDate.setDate(today.getDate() - 30);
                    url = `https://api.polygon.io/v2/aggs/ticker/SPY/range/1/day/${fromDate.toISOString().split('T')[0]}/${today.toISOString().split('T')[0]}?adjusted=true&sort=asc&apikey=${apiKey}`;
            }

            console.log('Trying Polygon API:', url);
            
            const response = await fetch(url);
            const data = await response.json();

            if (data.results && data.results.length > 0) {
                this.processPolygonData(data.results);
                return true;
            }
            
            return false;
        } catch (error) {
            console.log('Polygon API failed:', error);
            return false;
        }
    }

    async tryIEXCloudAPI() {
        try {
            // IEX Cloud API (tiene versión gratuita)
            const token = 'demo'; // Token demo
            let url;
            
            switch(this.chartPeriod) {
                case '1d':
                    url = `https://api.iextrading.com/1.0/stock/spy/chart/1d`;
                    break;
                case '7d':
                    url = `https://api.iextrading.com/1.0/stock/spy/chart/7d`;
                    break;
                case '30d':
                default:
                    url = `https://api.iextrading.com/1.0/stock/spy/chart/1m`;
            }

            console.log('Trying IEX Cloud API:', url);
            
            const response = await fetch(url);
            const data = await response.json();

            if (data && data.length > 0) {
                this.processIEXData(data);
                return true;
            }
            
            return false;
        } catch (error) {
            console.log('IEX Cloud API failed:', error);
            return false;
        }
    }

    async tryFinnhubAPI() {
        try {
            // Finnhub API gratuita
            const apiKey = 'demo'; // API key demo
            const symbol = 'SPY';
            
            let resolution, from, to;
            const now = Math.floor(Date.now() / 1000);
            
            switch(this.chartPeriod) {
                case '1d':
                    resolution = '5';
                    from = now - (24 * 60 * 60); // 1 día atrás
                    break;
                case '7d':
                    resolution = 'D';
                    from = now - (7 * 24 * 60 * 60); // 7 días atrás
                    break;
                case '30d':
                default:
                    resolution = 'D';
                    from = now - (30 * 24 * 60 * 60); // 30 días atrás
            }
            
            const url = `https://finnhub.io/api/v1/stock/candle?symbol=${symbol}&resolution=${resolution}&from=${from}&to=${now}&token=${apiKey}`;
            
            console.log('Trying Finnhub API:', url);
            
            const response = await fetch(url);
            const data = await response.json();

            if (data.c && data.c.length > 0) {
                this.processFinnhubData(data);
                return true;
            }
            
            return false;
        } catch (error) {
            console.log('Finnhub API failed:', error);
            return false;
        }
    }

    async generateRealisticHistoricalData() {
        // Obtener precio actual si está disponible
        let currentPrice = 450; // Precio base por defecto
        
        const priceElement = document.getElementById('currentPrice');
        if (priceElement && priceElement.textContent !== 'Cargando...') {
            const priceText = priceElement.textContent.replace('$', '').replace(',', '');
            const parsed = parseFloat(priceText);
            if (!isNaN(parsed)) {
                currentPrice = parsed;
            }
        }

        // Usar patrones de mercado más realistas
        const marketPatterns = this.generateMarketPatterns(currentPrice);
        
        const labels = [];
        const prices = [];

        marketPatterns.forEach((price, index) => {
            let date;
            
            if (this.chartPeriod === '1d') {
                date = new Date();
                date.setMinutes(date.getMinutes() - ((marketPatterns.length - 1 - index) * 15));
                labels.push(date.toLocaleTimeString('es-ES', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                }));
            } else {
                date = new Date();
                date.setDate(date.getDate() - (marketPatterns.length - 1 - index));
                labels.push(date.toLocaleDateString('es-ES', { 
                    month: 'short', 
                    day: 'numeric' 
                }));
            }
            
            prices.push(price);
        });

        this.chart.data.labels = labels;
        this.chart.data.datasets[0].data = prices;
        this.chart.update();

        this.updateDataStatus('simulated', `Datos estimados (${prices.length} puntos)`);
        this.showError('Las APIs gratuitas tienen limitaciones. Mostrando datos históricos estimados basados en patrones de mercado reales.');
    }

    generateMarketPatterns(currentPrice) {
        let dataPoints;
        switch(this.chartPeriod) {
            case '1d':
                dataPoints = 26; // Cada 15 minutos por ~6.5 horas
                break;
            case '7d':
                dataPoints = 7;
                break;
            case '30d':
            default:
                dataPoints = 30;
        }

        const prices = [];
        let price = currentPrice;
        
        // Crear tendencia más realista
        const trendDirection = Math.random() > 0.5 ? 1 : -1;
        const volatility = this.chartPeriod === '1d' ? 0.005 : 0.02; // 0.5% intradiario, 2% diario
        
        for (let i = 0; i < dataPoints; i++) {
            // Simular patrones de mercado realistas
            const randomWalk = (Math.random() - 0.5) * 2 * volatility * price;
            const trendComponent = trendDirection * 0.001 * price * Math.sin(i / dataPoints * Math.PI);
            
            price += randomWalk + trendComponent;
            
            // Mantener dentro de un rango razonable
            price = Math.max(currentPrice * 0.85, Math.min(currentPrice * 1.15, price));
            
            prices.push(parseFloat(price.toFixed(2)));
        }

        return prices;
    }

    updateDataStatus(type, message) {
        const indicator = document.getElementById('statusIndicator');
        const text = document.getElementById('statusText');
        
        // Limpiar clases anteriores
        indicator.className = 'status-indicator';
        
        // Agregar nueva clase y actualizar texto
        switch(type) {
            case 'real':
                indicator.classList.add('real');
                break;
            case 'simulated':
                indicator.classList.add('simulated');
                break;
            case 'error':
                indicator.classList.add('error');
                break;
        }
        
        text.textContent = message;
    }

    updateChartTitle() {
        const titleElement = document.querySelector('.chart-container h2');
        let titleText;
        
        switch(this.chartPeriod) {
            case '1d':
                titleText = 'Histórico - Últimas horas (intradiario)';
                break;
            case '7d':
                titleText = 'Histórico - Últimos 7 días';
                break;
            case '30d':
            default:
                titleText = 'Histórico - Últimos 30 días';
        }
        
        if (titleElement) {
            titleElement.textContent = titleText;
        }
    }

    processPolygonData(results) {
        const labels = [];
        const prices = [];

        results.forEach(result => {
            const date = new Date(result.t);
            
            if (this.chartPeriod === '1d') {
                labels.push(date.toLocaleTimeString('es-ES', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                }));
            } else {
                labels.push(date.toLocaleDateString('es-ES', { 
                    month: 'short', 
                    day: 'numeric' 
                }));
            }
            
            prices.push(result.c); // Precio de cierre
        });

        this.chart.data.labels = labels;
        this.chart.data.datasets[0].data = prices;
        this.chart.update();

        this.updateDataStatus('real', `Datos reales Polygon (${prices.length} puntos)`);
        this.clearError();
        console.log(`Successfully loaded ${prices.length} real data points from Polygon`);
    }

    processIEXData(data) {
        const labels = [];
        const prices = [];

        data.forEach(item => {
            if (this.chartPeriod === '1d') {
                const time = item.minute || item.label;
                labels.push(time);
            } else {
                const date = new Date(item.date);
                labels.push(date.toLocaleDateString('es-ES', { 
                    month: 'short', 
                    day: 'numeric' 
                }));
            }
            
            prices.push(item.close || item.average);
        });

        this.chart.data.labels = labels;
        this.chart.data.datasets[0].data = prices;
        this.chart.update();

        this.updateDataStatus('real', `Datos reales IEX (${prices.length} puntos)`);
        this.clearError();
        console.log(`Successfully loaded ${prices.length} real data points from IEX`);
    }

    processFinnhubData(data) {
        const labels = [];
        const prices = [];

        for (let i = 0; i < data.c.length; i++) {
            const date = new Date(data.t[i] * 1000);
            
            if (this.chartPeriod === '1d') {
                labels.push(date.toLocaleTimeString('es-ES', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                }));
            } else {
                labels.push(date.toLocaleDateString('es-ES', { 
                    month: 'short', 
                    day: 'numeric' 
                }));
            }
            
            prices.push(data.c[i]); // Precio de cierre
        }

        this.chart.data.labels = labels;
        this.chart.data.datasets[0].data = prices;
        this.chart.update();

        this.updateDataStatus('real', `Datos reales Finnhub (${prices.length} puntos)`);
        this.clearError();
        console.log(`Successfully loaded ${prices.length} real data points from Finnhub`);
    }

    async processYahooFinanceData(result) {
        const labels = [];
        const prices = [];
        
        const timestamps = result.timestamp;
        const closes = result.indicators.quote[0].close;

        if (!timestamps || !closes) {
            console.log('No timestamps or closes data available');
            return false;
        }

        console.log(`Processing ${timestamps.length} data points for period ${this.chartPeriod}`);

        // Filtrar datos según el período y crear arrays
        const now = new Date();
        let filteredData = [];

        for (let i = 0; i < timestamps.length; i++) {
            if (closes[i] !== null && closes[i] !== undefined) {
                const date = new Date(timestamps[i] * 1000);
                
                // Filtrar según el período
                let includePoint = false;
                switch(this.chartPeriod) {
                    case '1d':
                        // Solo puntos del día actual o últimas 24 horas
                        includePoint = (now - date) <= (24 * 60 * 60 * 1000);
                        break;
                    case '7d':
                        // Últimos 7 días
                        includePoint = (now - date) <= (7 * 24 * 60 * 60 * 1000);
                        break;
                    case '30d':
                    default:
                        // Últimos 30 días
                        includePoint = (now - date) <= (30 * 24 * 60 * 60 * 1000);
                        break;
                }

                if (includePoint) {
                    filteredData.push({
                        timestamp: timestamps[i],
                        date: date,
                        price: closes[i]
                    });
                }
            }
        }

        // Limitar número de puntos para mejor rendimiento
        let maxPoints;
        switch(this.chartPeriod) {
            case '1d':
                maxPoints = 80; // Máximo 80 puntos para el día
                break;
            case '7d':
                maxPoints = 50; // Máximo 50 puntos para 7 días
                break;
            case '30d':
            default:
                maxPoints = 60; // Máximo 60 puntos para 30 días
        }

        if (filteredData.length > maxPoints) {
            // Tomar puntos distribuidos uniformemente
            const step = Math.floor(filteredData.length / maxPoints);
            const sampledData = [];
            for (let i = 0; i < filteredData.length; i += step) {
                sampledData.push(filteredData[i]);
            }
            filteredData = sampledData;
        }

        // Crear labels y precios
        filteredData.forEach(item => {
            if (this.chartPeriod === '1d') {
                labels.push(item.date.toLocaleTimeString('es-ES', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                }));
            } else {
                labels.push(item.date.toLocaleDateString('es-ES', { 
                    month: 'short', 
                    day: 'numeric' 
                }));
            }
            
            prices.push(item.price);
        });

        if (prices.length === 0) {
            console.log('No valid data points after filtering');
            return false;
        }

        // Guardar en base de datos
        const dbData = filteredData.map(item => ({
            timestamp: item.timestamp * 1000, // Convertir a millisegundos
            price: item.price,
            date: item.date.toISOString()
        }));
        
        try {
            await this.saveHistoricalDataToDB(this.chartPeriod, dbData);
            console.log(`Saved ${dbData.length} data points to database for ${this.chartPeriod}`);
        } catch (error) {
            console.error('Error saving to database:', error);
        }

        this.chart.data.labels = labels;
        this.chart.data.datasets[0].data = prices;
        this.chart.update();

        this.updateDataStatus('real', `Datos actualizados desde API (${prices.length} puntos - ${this.chartPeriod})`);
        this.clearError();
        console.log(`Successfully loaded ${prices.length} real data points from Yahoo Finance for ${this.chartPeriod}`);
        return true;
    }

    processHistoricalData(data) {
        let timeSeries;
        
        // Buscar la clave correcta de los datos de serie temporal
        if (this.chartPeriod === '1d') {
            // Para datos intradiarios
            const timeSeriesKey = Object.keys(data).find(key => 
                key.includes('Time Series') && key.includes('15min')
            );
            timeSeries = data[timeSeriesKey];
        } else {
            // Para datos diarios
            timeSeries = data['Time Series (Daily)'];
        }

        if (!timeSeries || Object.keys(timeSeries).length === 0) {
            console.log('No time series data found');
            return false;
        }

        console.log('Processing real historical data, entries:', Object.keys(timeSeries).length);

        const labels = [];
        const prices = [];
        const entries = Object.entries(timeSeries);

        // Filtrar y limitar datos según el período
        let filteredEntries;
        const now = new Date();
        
        switch(this.chartPeriod) {
            case '1d':
                // Datos del día actual solamente
                filteredEntries = entries.filter(([date]) => {
                    const entryDate = new Date(date);
                    return entryDate.toDateString() === now.toDateString();
                }).slice(0, 50); // Máximo 50 puntos para el día
                break;
            case '7d':
                // Últimos 7 días
                const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                filteredEntries = entries.filter(([date]) => {
                    return new Date(date) >= sevenDaysAgo;
                }).slice(0, 7);
                break;
            case '30d':
            default:
                // Últimos 30 días
                filteredEntries = entries.slice(0, 30);
        }

        if (filteredEntries.length === 0) {
            console.log('No data for selected period');
            return false;
        }

        // Ordenar cronológicamente (más antiguo primero)
        filteredEntries.sort(([a], [b]) => new Date(a) - new Date(b));

        filteredEntries.forEach(([date, values]) => {
            const price = parseFloat(values['4. close']);
            
            if (this.chartPeriod === '1d') {
                labels.push(new Date(date).toLocaleTimeString('es-ES', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                }));
            } else {
                labels.push(new Date(date).toLocaleDateString('es-ES', { 
                    month: 'short', 
                    day: 'numeric' 
                }));
            }
            
            prices.push(price);
        });

        // Actualizar el gráfico con datos reales
        this.chart.data.labels = labels;
        this.chart.data.datasets[0].data = prices;
        this.chart.update();

        // Limpiar mensajes de error si los datos se cargaron correctamente
        if (prices.length > 0) {
            this.clearError();
            this.updateDataStatus('real', `Datos reales (${prices.length} puntos)`);
            console.log(`Successfully loaded ${prices.length} real data points for ${this.chartPeriod}`);
            return true;
        }
        
        return false;
    }

    generateSimulatedHistoricalData() {
        const labels = [];
        const prices = [];
        let basePrice = 450 + Math.random() * 100;

        let dataPoints;
        switch(this.chartPeriod) {
            case '1d':
                dataPoints = 78; // Cada 5 minutos por ~6.5 horas
                break;
            case '7d':
                dataPoints = 7;
                break;
            case '30d':
            default:
                dataPoints = 30;
        }

        for (let i = dataPoints - 1; i >= 0; i--) {
            let date;
            
            if (this.chartPeriod === '1d') {
                date = new Date();
                date.setMinutes(date.getMinutes() - (i * 5));
                labels.push(date.toLocaleTimeString('es-ES', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                }));
            } else {
                date = new Date();
                date.setDate(date.getDate() - i);
                labels.push(date.toLocaleDateString('es-ES', { 
                    month: 'short', 
                    day: 'numeric' 
                }));
            }

            // Simulación de variación de precio
            basePrice += (Math.random() - 0.5) * 5;
            prices.push(Math.max(400, Math.min(600, basePrice))); // Mantener entre 400-600
        }

        this.chart.data.labels = labels;
        this.chart.data.datasets[0].data = prices;
        this.chart.update();

        this.updateDataStatus('simulated', 'Datos simulados');
        if (!document.getElementById('errorMessage').textContent.includes('histórico')) {
            this.showError('Mostrando datos históricos simulados. Para datos reales, verifica tu conexión a la API.');
        }
    }
}

// Inicializar el monitor cuando se carga la página
document.addEventListener('DOMContentLoaded', () => {
    new SP500Monitor();
});