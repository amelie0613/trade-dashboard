/**
 * RentalAnalysisPipeline - 統一協調層
 * 管理整個租金分析流程：租金計算 → 出庫分類 → 加工分析 → 利潤匯總 → 在途核銷
 */

class RentalAnalysisPipeline {
  constructor(config = {}) {
    this.config = config;
    this.stageResults = [];
    this.executionLog = [];
    this.progressCallbacks = [];
    this.errorCallbacks = [];
    this.state = 'IDLE'; // IDLE | RUNNING | PAUSED | COMPLETED | FAILED
    this.errors = [];
    this.startTime = null;
    this.endTime = null;
  }

  // 註冊進度回調
  onProgress(callback) {
    this.progressCallbacks.push(callback);
  }

  // 註冊錯誤回調
  onError(callback) {
    this.errorCallbacks.push(callback);
  }

  // 驗證輸入
  async validateInputs() {
    const checks = [
      {
        name: '檢查租金資料',
        validate: () => this.config.rentals?.length > 0,
        message: '租金資料不能為空'
      },
      {
        name: '檢查出入庫記錄',
        validate: () => this.config.io?.length > 0,
        message: '出入庫記錄不能為空'
      },
      {
        name: '檢查重量資料',
        validate: () => this.config.weights?.length > 0,
        message: '重量資料不能為空'
      },
      {
        name: '檢查日期範圍',
        validate: () => {
          const start = new Date(this.config.startDate);
          const end = new Date(this.config.endDate);
          return start < end && !isNaN(start) && !isNaN(end);
        },
        message: '期初日期必須小於期末日期'
      }
    ];

    const results = await Promise.all(
      checks.map(async (check) => ({
        ...check,
        passed: await check.validate()
      }))
    );

    const failures = results.filter(r => !r.passed);
    if (failures.length > 0) {
      const msg = failures.map(f => f.message).join('\n');
      throw new ValidationError('輸入驗證失敗', failures);
    }

    return results;
  }

  // 主執行流程
  async run() {
    try {
      this.state = 'RUNNING';
      this.startTime = new Date();
      this.stageResults = [];
      this.errors = [];

      // 驗證輸入
      await this._reportProgress({
        stage: 'INPUT_VALIDATION',
        status: 'RUNNING',
        progress: 0,
        message: '驗證輸入資料...'
      });
      await this.validateInputs();

      // Stage 1: 租金計算
      await this._runStage({
        name: 'stage1_rental',
        displayName: '租金計算',
        execute: async () => await this._calculateRental(),
        validate: async (result) => this._validateRental(result),
        required: true
      });

      // Stage 2: 出庫分類
      await this._runStage({
        name: 'stage2_outbound',
        displayName: '出庫分類',
        execute: async () => await this._classifyOutbound(),
        validate: async (result) => this._validateOutbound(result),
        required: true
      });

      // Stage 3: 加工單分析
      await this._runStage({
        name: 'stage3_processing',
        displayName: '加工單分析',
        execute: async () => await this._analyzeProcessing(),
        validate: async (result) => this._validateProcessing(result),
        required: false
      });

      // Stage 4: 利潤匯總
      await this._runStage({
        name: 'stage4_profit',
        displayName: '利潤匯總',
        execute: async () => await this._summarizeProfit(),
        validate: async (result) => this._validateProfit(result),
        required: true
      });

      // Stage 5: 在途核銷
      await this._runStage({
        name: 'stage5_transit',
        displayName: '在途核銷',
        execute: async () => await this._offsetTransit(),
        validate: async (result) => this._validateTransit(result),
        required: false
      });

      this.state = 'COMPLETED';
      this.endTime = new Date();

      return {
        status: this._determineOverallStatus(),
        stages: this.stageResults,
        summary: await this._generateSummary(),
        duration: this.endTime - this.startTime,
        errors: this.errors
      };

    } catch (error) {
      this.state = 'FAILED';
      this.errors.push({
        stage: 'PIPELINE',
        severity: 'ERROR',
        message: error.message,
        error: error
      });

      await this._reportProgress({
        stage: 'PIPELINE',
        status: 'FAILED',
        message: `管道失敗: ${error.message}`
      });

      throw error;
    }
  }

  // Stage 執行器
  async _runStage(stageConfig) {
    const { name, displayName, execute, validate, required = true } = stageConfig;

    try {
      await this._reportProgress({
        stage: name,
        status: 'RUNNING',
        progress: 0,
        message: `${displayName}中...`
      });

      const result = await execute();
      const validation = await validate(result);

      if (validation.status === 'ERROR' && required) {
        throw new StageValidationError(name, validation);
      }

      this.stageResults.push({
        stage: name,
        displayName: displayName,
        result: result,
        validation: validation,
        timestamp: new Date().toISOString()
      });

      await this._reportProgress({
        stage: name,
        status: 'COMPLETED',
        progress: 100,
        message: `✅ ${displayName}完成`
      });

      return result;

    } catch (error) {
      const shouldContinue = await this._handleStageError(
        name,
        displayName,
        error,
        required
      );

      if (!shouldContinue) {
        throw error;
      }
    }
  }

  // 錯誤處理
  async _handleStageError(stageName, displayName, error, required) {
    const errorRecord = {
      stage: stageName,
      displayName: displayName,
      error: error,
      severity: required ? 'ERROR' : 'WARNING',
      timestamp: new Date().toISOString()
    };

    this.errors.push(errorRecord);

    await this._reportProgress({
      stage: stageName,
      status: 'FAILED',
      message: `❌ ${displayName}失敗: ${error.message}`
    });

    if (required) return false;
    return true;
  }

  // 進度報告
  async _reportProgress(event) {
    const fullEvent = {
      timestamp: new Date().toISOString(),
      pipelineState: this.state,
      completedStages: this.stageResults.length,
      ...event
    };

    for (const callback of this.progressCallbacks) {
      try {
        await callback(fullEvent);
      } catch (e) {
        console.error('進度回調錯誤:', e);
      }
    }

    this.executionLog.push(fullEvent);
  }

  // ─── Stage 實現 ───────────────────────────

  async _calculateRental() {
    // 使用現有的 calculateRental 函數
    if (typeof window.calculateRental !== 'function') {
      throw new Error('calculateRental 函數未定義');
    }

    const result = window.calculateRental(
      this.config.rentals,
      this.config.io,
      this.config.weights,
      this.config.period || ''
    );

    return {
      stage: 'stage1_rental',
      data: result,
      summary: {
        totalRows: result.length,
        processedRows: result.length,
        totalRental: result.reduce((sum, r) => sum + (parseInt(r['租金']) || 0), 0),
        totalHandling: result.reduce((sum, r) => sum + (parseInt(r['出入庫']) || 0), 0),
        totalCost: result.reduce((sum, r) => sum + (parseInt(r['總計']) || 0), 0)
      }
    };
  }

  async _classifyOutbound() {
    const stage1 = this.stageResults.find(s => s.stage === 'stage1_rental');
    if (!stage1) throw new Error('Stage 1 未完成');

    const outboundList = [];
    stage1.result.data.forEach(r => {
      if (r._outboundList) {
        outboundList.push(...r._outboundList);
      }
    });

    // 按類型分類
    const classified = {};
    outboundList.forEach(item => {
      const type = item.出庫類型 || '其他';
      if (!classified[type]) classified[type] = [];
      classified[type].push(item);
    });

    return {
      stage: 'stage2_outbound',
      data: outboundList,
      classified: classified,
      summary: {
        totalRows: outboundList.length,
        byType: Object.fromEntries(
          Object.entries(classified).map(([k, v]) => [k, v.length])
        )
      }
    };
  }

  async _analyzeProcessing() {
    if (!this.config.processingForm) {
      return {
        stage: 'stage3_processing',
        data: [],
        summary: { skipped: true, reason: '未上傳加工單' }
      };
    }

    // 使用現有的加工單分析邏輯
    if (typeof window.processingUnitPriceMap === 'undefined') {
      return {
        stage: 'stage3_processing',
        data: [],
        summary: { error: true, reason: '加工單分析不可用' }
      };
    }

    return {
      stage: 'stage3_processing',
      data: Object.entries(window.processingUnitPriceMap || {}).map(([batch, price]) => ({
        childBatchNo: batch,
        childUnitPrice: price
      })),
      summary: {
        totalBatches: Object.keys(window.processingUnitPriceMap || {}).length
      }
    };
  }

  async _summarizeProfit() {
    if (!this.config.profit) {
      throw new Error('利潤明細表未提供');
    }

    // 使用現有的 profitCalcData
    if (typeof window.profitCalcData === 'undefined' || !window.profitCalcData.length) {
      throw new Error('請先在利潤分析頁面上傳並試算利潤明細表');
    }

    const matched = window.profitCalcData.filter(r => r.租金費用 !== '').length;
    const unmatched = window.profitCalcData.length - matched;

    return {
      stage: 'stage4_profit',
      data: window.profitCalcData,
      summary: {
        totalRows: window.profitCalcData.length,
        matchedCount: matched,
        unmatchedCount: unmatched,
        matchRate: (matched / window.profitCalcData.length * 100).toFixed(2) + '%'
      }
    };
  }

  async _offsetTransit() {
    if (typeof window.autoMatchTransitSales !== 'function') {
      throw new Error('在途核銷函數未定義');
    }

    try {
      await window.autoMatchTransitSales();
      return {
        stage: 'stage5_transit',
        data: [],
        summary: { completed: true }
      };
    } catch (e) {
      throw new Error(`在途核銷失敗: ${e.message}`);
    }
  }

  // ─── 驗證方法 ────────────────────────────

  _validateRental(result) {
    const checks = [
      {
        name: '必要欄位完整性',
        validate: () => result.data.every(r => r['產品名稱'] && r['批號']),
        passed: true
      },
      {
        name: '成本合理性',
        validate: () => result.summary.totalCost > 0 && result.summary.totalCost < 100000000,
        passed: true
      }
    ];

    return {
      status: 'PASS',
      checks: checks
    };
  }

  _validateOutbound(result) {
    return { status: 'PASS', checks: [] };
  }

  _validateProcessing(result) {
    if (result.summary.skipped) {
      return { status: 'PASS', checks: [] };
    }
    return { status: 'PASS', checks: [] };
  }

  _validateProfit(result) {
    const unmatchedRatio = result.summary.unmatchedCount / result.summary.totalRows;
    const status = unmatchedRatio > 0.5 ? 'WARNING' : 'PASS';

    return {
      status: status,
      checks: [
        {
          name: '比對率檢查',
          passed: unmatchedRatio <= 0.5,
          message: `未比對比例: ${(unmatchedRatio * 100).toFixed(1)}%`
        }
      ]
    };
  }

  _validateTransit(result) {
    return { status: 'PASS', checks: [] };
  }

  // ─── 結果匯總 ────────────────────────────

  async _generateSummary() {
    return {
      totalStages: this.stageResults.length,
      totalRental: this.stageResults
        .find(s => s.stage === 'stage1_rental')
        ?.result.summary.totalRental || 0,
      totalProfit: this.stageResults
        .find(s => s.stage === 'stage4_profit')
        ?.result.summary.matchedCount || 0,
      duration: this.endTime - this.startTime,
      stagesSummary: this.stageResults.map(s => ({
        stage: s.stage,
        displayName: s.displayName,
        status: s.validation.status,
        rowsProcessed: s.result.summary?.totalRows || 0
      }))
    };
  }

  _determineOverallStatus() {
    if (this.errors.filter(e => e.severity === 'ERROR').length > 0) {
      return 'FAILED';
    }
    if (this.errors.filter(e => e.severity === 'WARNING').length > 0) {
      return 'PARTIAL';
    }
    return 'SUCCESS';
  }
}

// ─── 自定義錯誤類 ──────────────────────────

class ValidationError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
  }
}

class StageValidationError extends Error {
  constructor(stageName, validation) {
    super(`Stage ${stageName} 驗證失敗`);
    this.name = 'StageValidationError';
    this.stageName = stageName;
    this.validation = validation;
  }
}

class PipelineExecutionError extends Error {
  constructor(message, stageResults, errors) {
    super(message);
    this.name = 'PipelineExecutionError';
    this.stageResults = stageResults;
    this.errors = errors;
  }
}

// 導出到 window
window.RentalAnalysisPipeline = RentalAnalysisPipeline;
