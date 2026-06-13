const API_BASE = 'http://localhost:3107/api';
const { createApp, ref, onMounted, computed } = Vue;

createApp({
  setup() {
    const isLoggedIn = ref(false);
    const user = ref(null);
    const token = ref(null);

    const loginForm = ref({ username: '', password: '' });
    const loginLoading = ref(false);
    const loginError = ref('');

    const dreams = ref([]);
    const randomDream = ref(null);
    const monthlyStats = ref({ count: 0, avgLucidity: 0 });

    const tasks = ref([]);
    const incompleteTasks = ref([]);
    const showTaskModal = ref(false);
    const showTaskBoard = ref(false);
    const editingTask = ref(null);
    const selectedDreamForTask = ref(null);
    const viewingDream = ref(null);

    const taskForm = ref({
      title: '',
      targetForm: '',
      status: 'pending'
    });

    const targetFormOptions = [
      '短篇小说',
      '长篇小说',
      '诗歌',
      '散文',
      '绘画',
      '插画',
      '漫画',
      '动画剧本',
      '游戏设定',
      '音乐创作',
      '其他'
    ];

    const now = new Date();
    const selectedYear = ref(now.getFullYear());
    const selectedMonth = ref(now.getMonth() + 1);
    const yearOptions = computed(() => {
      const current = new Date().getFullYear();
      const years = [];
      for (let y = current - 5; y <= current; y++) {
        years.push(y);
      }
      return years;
    });

    const newDream = ref({
      content: '',
      lucidity: 3,
      date: new Date().toISOString().split('T')[0]
    });

    const isPlaying = ref(false);
    let audioContext = null;
    let noiseNode = null;
    let gainNode = null;

    function getToken() {
      return localStorage.getItem('dream_token');
    }

    function saveToken(t) {
      localStorage.setItem('dream_token', t);
      token.value = t;
    }

    function clearToken() {
      localStorage.removeItem('dream_token');
      token.value = null;
    }

    function saveUser(u) {
      localStorage.setItem('dream_user', JSON.stringify(u));
      user.value = u;
    }

    function loadUser() {
      const saved = localStorage.getItem('dream_user');
      if (saved) {
        user.value = JSON.parse(saved);
        isLoggedIn.value = true;
      }
    }

    async function apiRequest(url, options = {}) {
      const headers = { 'Content-Type': 'application/json', ...options.headers };
      const t = getToken();
      if (t) {
        headers['Authorization'] = `Bearer ${t}`;
      }

      const response = await fetch(`${API_BASE}${url}`, {
        ...options,
        headers
      });

      if (response.status === 401 || response.status === 403) {
        clearToken();
        isLoggedIn.value = false;
        user.value = null;
        throw new Error('未登录');
      }

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '请求失败');
      }
      return data;
    }

    async function handleLogin() {
      if (!loginForm.value.username || !loginForm.value.password) {
        loginError.value = '请输入用户名和密码';
        return;
      }

      loginLoading.value = true;
      loginError.value = '';

      try {
        const data = await apiRequest('/login', {
          method: 'POST',
          body: JSON.stringify(loginForm.value)
        });

        saveToken(data.token);
        saveUser(data.user);
        isLoggedIn.value = true;
        loadData();
      } catch (e) {
        console.error('Login error:', e);
        loginError.value = e.message;
      } finally {
        loginLoading.value = false;
      }
    }

    function handleLogout() {
      clearToken();
      stopWhiteNoise();
      isLoggedIn.value = false;
      user.value = null;
      dreams.value = [];
      randomDream.value = null;
    }

    async function fetchDreams() {
      try {
        const data = await apiRequest('/dreams');
        dreams.value = data;
      } catch (e) {
        console.error('获取梦境列表失败', e);
      }
    }

    async function fetchRandomDream() {
      try {
        const data = await apiRequest('/dreams/random');
        randomDream.value = data;
        if (!isPlaying.value) {
          startWhiteNoise();
          setTimeout(() => {
            stopWhiteNoise();
          }, 12000);
        }
      } catch (e) {
        alert(e.message);
      }
    }

    async function fetchMonthlyStats() {
      try {
        const data = await apiRequest(`/stats/monthly?year=${selectedYear.value}&month=${selectedMonth.value}`);
        monthlyStats.value = data;
      } catch (e) {
        console.error('获取月度统计失败', e);
      }
    }

    function onMonthChange() {
      fetchMonthlyStats();
    }

    async function addDream() {
      if (!newDream.value.content.trim()) {
        alert('请输入梦境内容');
        return;
      }

      try {
        await apiRequest('/dreams', {
          method: 'POST',
          body: JSON.stringify(newDream.value)
        });

        newDream.value = {
          content: '',
          lucidity: 3,
          date: new Date().toISOString().split('T')[0]
        };

        loadData();
      } catch (e) {
        alert(e.message);
      }
    }

    async function fetchTasks() {
      try {
        const data = await apiRequest('/tasks');
        tasks.value = data;
      } catch (e) {
        console.error('获取任务列表失败', e);
      }
    }

    async function fetchIncompleteTasks() {
      try {
        const data = await apiRequest('/tasks/incomplete');
        incompleteTasks.value = data;
      } catch (e) {
        console.error('获取未完成任务失败', e);
      }
    }

    function openTaskModal(dream = null, task = null) {
      if (task) {
        editingTask.value = task;
        taskForm.value = {
          title: task.title,
          targetForm: task.targetForm,
          status: task.status
        };
        const sourceDream = dreams.value.find(d => d.id === task.dreamId);
        selectedDreamForTask.value = sourceDream || null;
      } else {
        if (!dream) {
          alert('请选择一个梦境后再创建任务');
          return;
        }
        editingTask.value = null;
        selectedDreamForTask.value = dream;
        taskForm.value = {
          title: dream.content.slice(0, 20) + '...',
          targetForm: '',
          status: 'pending'
        };
      }
      showTaskModal.value = true;
    }

    function closeTaskModal() {
      showTaskModal.value = false;
      editingTask.value = null;
      selectedDreamForTask.value = null;
      taskForm.value = {
        title: '',
        targetForm: '',
        status: 'pending'
      };
    }

    async function saveTask() {
      if (!taskForm.value.title.trim()) {
        alert('请输入任务标题');
        return;
      }
      if (!taskForm.value.targetForm) {
        alert('请选择目标形式');
        return;
      }

      try {
        if (editingTask.value) {
          await apiRequest(`/tasks/${editingTask.value.id}`, {
            method: 'PUT',
            body: JSON.stringify(taskForm.value)
          });
        } else {
          if (!selectedDreamForTask.value) {
            alert('创建任务必须绑定原始梦境');
            return;
          }
          await apiRequest('/tasks', {
            method: 'POST',
            body: JSON.stringify({
              ...taskForm.value,
              dreamId: selectedDreamForTask.value.id
            })
          });
        }
        closeTaskModal();
        loadData();
      } catch (e) {
        alert(e.message);
      }
    }

    async function updateTaskStatus(task, status) {
      try {
        await apiRequest(`/tasks/${task.id}`, {
          method: 'PUT',
          body: JSON.stringify({ status })
        });
        loadData();
      } catch (e) {
        alert(e.message);
      }
    }

    async function deleteTask(taskId) {
      if (!confirm('确定要删除这个任务吗？')) {
        return;
      }
      try {
        await apiRequest(`/tasks/${taskId}`, {
          method: 'DELETE'
        });
        loadData();
      } catch (e) {
        alert(e.message);
      }
    }

    async function viewDreamFromTask(task) {
      if (!task.dreamId) {
        alert('该任务没有关联的原始梦境');
        return;
      }
      try {
        const dream = await apiRequest(`/dreams/${task.dreamId}`);
        viewingDream.value = dream;
      } catch (e) {
        alert(e.message);
      }
    }

    function closeDreamView() {
      viewingDream.value = null;
    }

    function getStatusText(status) {
      const map = {
        'pending': '待开始',
        'in_progress': '进行中',
        'completed': '已完成'
      };
      return map[status] || status;
    }

    function getStatusClass(status) {
      const map = {
        'pending': 'status-pending',
        'in_progress': 'status-progress',
        'completed': 'status-completed'
      };
      return map[status] || '';
    }

    function loadData() {
      fetchDreams();
      fetchMonthlyStats();
      fetchTasks();
      fetchIncompleteTasks();
    }

    function createWhiteNoise() {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioContext();

      const bufferSize = 2 * audioContext.sampleRate;
      const noiseBuffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
      const output = noiseBuffer.getChannelData(0);

      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      noiseNode = audioContext.createBufferSource();
      noiseNode.buffer = noiseBuffer;
      noiseNode.loop = true;

      gainNode = audioContext.createGain();
      gainNode.gain.value = 0.05;

      const filter = audioContext.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1000;

      noiseNode.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(audioContext.destination);

      noiseNode.start();
    }

    function toggleWhiteNoise() {
      if (isPlaying.value) {
        stopWhiteNoise();
      } else {
        startWhiteNoise();
      }
    }

    function startWhiteNoise() {
      if (!audioContext) {
        createWhiteNoise();
      } else if (audioContext.state === 'suspended') {
        audioContext.resume();
      }
      if (gainNode) {
        gainNode.gain.setValueAtTime(0.05, audioContext.currentTime);
      }
      isPlaying.value = true;
    }

    function stopWhiteNoise() {
      if (gainNode && audioContext) {
        gainNode.gain.setValueAtTime(0, audioContext.currentTime);
      }
      isPlaying.value = false;
    }

    onMounted(() => {
      loadUser();
      if (isLoggedIn.value) {
        loadData();
      }
    });

    return {
      isLoggedIn,
      user,
      loginForm,
      loginLoading,
      loginError,
      handleLogin,
      handleLogout,
      dreams,
      randomDream,
      monthlyStats,
      newDream,
      fetchRandomDream,
      addDream,
      isPlaying,
      toggleWhiteNoise,
      selectedYear,
      selectedMonth,
      yearOptions,
      onMonthChange,
      tasks,
      incompleteTasks,
      showTaskModal,
      showTaskBoard,
      editingTask,
      selectedDreamForTask,
      viewingDream,
      taskForm,
      targetFormOptions,
      openTaskModal,
      closeTaskModal,
      saveTask,
      updateTaskStatus,
      deleteTask,
      viewDreamFromTask,
      closeDreamView,
      getStatusText,
      getStatusClass
    };
  }
}).mount('#app');
